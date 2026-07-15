# 나두AI API 마켓플레이스 (cso-platform)

제약 CSO 분야를 시작으로, 여러 AI API를 카탈로그에서 골라 **API 키 하나로 호출**하는 GCP Cloud Run 기반 멀티 프로덕트 API 플랫폼입니다.

- **마켓플레이스/포털** — `market.nadoo.ai` : API 카탈로그·문서(Swagger 수준)·라이브 데모·고객 대시보드(키 발급·크레딧·사용량)·어드민(`/admin`)
- **API 게이트웨이** — `marketapi.nadoo.ai` : `x-api-key` 인증 → 크레딧 과금 → 프로세서 프록시 → 호출이력 적재
- **프로세서** — 프로덕트별 처리 엔진(Cloud Run). 1호 프로덕트는 처방전 이미지에서 **HIRA 약가코드(9자리)** 를 검출하고 **제약사명**을 태깅하는 OCR 엔진(`hira-detect`).

첫 프로덕트의 상세 기능·판매 계획은 [docs/PLATFORM-PLAN.md](docs/PLATFORM-PLAN.md), UI/UX는 [docs/UI-UX-PLAN.md](docs/UI-UX-PLAN.md), 구현 계획은 [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) 참고.

## 아키텍처

```
 고객 ──x-api-key──▶  gateway (marketapi.nadoo.ai, 공개)
                        │  1) verifyApiKey (SHA-256 해시 대조)
                        │  2) Product 조회 (slug → priceKrw/freeQuota/processorUrl)
                        │  3) Entitlement·chargeForCall (무료쿼터 → 크레딧 원자적 과금)
                        │  4) processor 프록시 (run.app 은 ID 토큰 인증)
                        ▼
                     processor-hira (asia-northeast3, 비공개)
                        │  전처리 → 회전판별 → Gemini OCR → DrugMaster 조회
                        │  → (멀티 제약사면) 라벨 태깅 → GCS 업로드(30일 TTL)
                        ▼
                     결과 JSON + 서명 URL  ──▶  BigQuery 호출이력 적재 / 크레딧 잔액 반환

 관리자 ──Google OIDC(nadoomodoo.com)──▶ portal /admin : 프로덕트·가격·크레딧충전·코마케팅·사용량
```

| 구성요소 | 기술 | 위치 |
|---|---|---|
| 포털/어드민 | Next.js 15 (App Router, NextAuth v5) | Cloud Run · Tokyo |
| 게이트웨이 | Node 22 (인증·과금·라우팅) | Cloud Run · Tokyo (`marketapi.nadoo.ai`) |
| 프로세서 | Node 22 + Sharp + Vertex Gemini | Cloud Run · Seoul (비공개) |
| 관계형 DB | Cloud SQL for PostgreSQL (Prisma 6) | Seoul — 사용자·키·프로덕트·크레딧원장·약가마스터·코마케팅 |
| 호출이력 | BigQuery (`platform.api_call_log`) | 저비용 대량 로그 |
| 결과 스토리지 | GCS `cso-ai-results` (30일 TTL) | 서명 URL 반환, 처방전 원본 미저장 |
| OCR | Vertex AI Gemini (`global` 리전) | 국외이전 약관 고지 |
| IaC | Pulumi (TypeScript), 상태=GCS+KMS | `infra/` |

## 모노레포 구조

```
packages/
  db/       @platform/db      Prisma 스키마 + PrismaClient 재수출 (공유 싱글턴)
  backend/  @platform/backend 게이트웨이·프로세서·검출 엔진 (아래 참조)
  portal/   @platform/portal  Next.js 포털·어드민·고객 대시보드·문서·데모
infra/                        Pulumi (Cloud SQL·GCS·BigQuery·Cloud Tasks·Secret·IAM)
docs/                         PLATFORM / UI-UX / IMPLEMENTATION 계획
cloudbuild-portal.yaml        포털 이미지 빌드
cloudbuild-backend.yaml       게이트웨이/프로세서 공용 이미지 빌드
```

pnpm 워크스페이스이며, 검출 엔진과 서버 진입점은 모두 `packages/backend/src/` 에 있습니다.

| 파일 | 역할 |
|---|---|
| `gateway.ts` | API 게이트웨이 — `POST /api/v1/{slug}/detect` : 키검증→과금→프로세서 프록시 |
| `server.ts` | 프로세서 HTTP 서버 — `POST /process`, `GET /healthz` |
| `pipeline.ts` | 검출 파이프라인 연결 (전처리→회전→OCR→조회→조건부 태깅→스토리지) |
| `billing.ts` | 크레딧 엔진 — `issueApiKey`/`verifyApiKey`/`chargeForCall`(원자적)/`refund` |
| `auth.ts` | 고객 가입·로그인 (scrypt 해시) |
| `preprocess.ts` | Sharp 리사이즈/JPEG 전처리, 토큰 추정, 회전 보정 |
| `ocr.ts` | Vertex Gemini — 회전 판별 + 약가코드 OCR (`box_2d` 규약) |
| `master.ts` | Cloud SQL `DrugMaster` 조회 → Map 캐시 (어드민 업로드/편집) |
| `annotate.ts` | Sharp+SVG 라벨 합성 (제약사별 파스텔 반투명 태깅) |
| `storage.ts` | GCS 업로드 + 서명 URL |
| `usage.ts` | Gemini 호출 사용량 집계 |

## API 사용

```bash
curl -X POST https://marketapi.nadoo.ai/api/v1/hira-detect/detect \
  -H "x-api-key: pk_live_xxxxxxxx" \
  -H "Content-Type: image/jpeg" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data-binary @처방전.jpg
```

- 인증: 대시보드에서 발급한 `x-api-key`(`pk_live_…`)
- 입력: 바이너리(`image/jpeg`·`image/png`) 또는 JSON(`image` base64 / `imageUrl`)
- 멱등: `Idempotency-Key` 로 재요청 이중 과금 방지
- 과금: 무료쿼터 소진 후 프로덕트별 단가(원)로 크레딧 차감, 프로세서 실패 시 자동 환불
- 결과: 검출 코드·제약사·의약품 + 결과 이미지(GCS 서명 URL) + 잔액

전체 필드 스펙·에러 코드·OpenAPI JSON 은 포털 문서(`/docs/api/hira-detect`)에서 제공합니다.

**과금 정책**: 프로덕트별 가격·무료쿼터는 어드민에서 설정하며, 크레딧은 입금 확인 후 **원 단위로 수동 충전**합니다. 무료쿼터 초과 시 사용신청 폼(→ Teams 웹훅)으로 접수합니다.

## 검출 엔진 (hira-detect 프로세서)

처방 내역·EDI 이미지에서 9자리 약가코드를 검출해 마스터에서 제약사명을 조회하고, **2종 이상 제약사**가 섞인 문서만 왼쪽 여백에 제약사명 라벨 + 제약사별 파스텔 반투명 하이라이트를 합성합니다(단일 제약사는 태깅 생략).

핵심 특징:

- **회전 판별**: EXIF 무시, Gemini가 픽셀을 직접 보고 4-way(0/90/180/270) 판별(confidence<0.6 미적용).
- **bbox 정확도**: Gemini 학습 규약(`box_2d`, `[ymin,xmin,ymax,xmax]` 0~1000 정규화) 필수. 임의 필드명은 좌표가 행 단위로 어긋남(실측 확인). 0~1000 비율이라 전처리 리사이즈와 무관하게 원본으로 정확히 역변환.
- **전처리(토큰 절약)**: Gemini는 768px 타일 단위 토큰화(`ceil(w/768)×ceil(h/768)×258`). 종횡비 보존하며 짧은 변 최소 1000px·긴 변 4096px 상한으로 리사이즈. 실측 9장에서 파일 95%·최대 이미지 토큰 14배 절감.
- **반복 루프 방어**: 근접 중복 박스(IoU>0.5) 병합, 검출 수가 유니크의 2.5배 초과 시 재시도(최대 2회)→상위 모델 폴백 1회.
- **일시 오류 백오프**: 모든 Gemini 호출 지수 백오프(최대 3회).
- **코마케팅 표기**: 위탁판매 코드는 어드민이 등록한 전역 매핑에 따라 다른 제약사명으로 표기.

## 로컬 개발

```bash
pnpm install
pnpm build:db                 # Prisma generate + @platform/db 빌드
# Cloud SQL 프록시로 로컬 5432 연결 후:
pnpm --filter @platform/portal dev     # 포털 (http://localhost:3000)
```

주요 환경변수(프로세서): `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`(Gemini 3.x 는 `global`), `MODEL_NAME`, `GCS_RESULT_BUCKET`, `DATABASE_URL`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`. 게이트웨이: `DATABASE_URL`, `BQ_DATASET`/`BQ_TABLE`, `APPLY_URL`. 운영 값은 Secret Manager 에 보관합니다(자격증명·API 키는 커밋 금지).

## 배포

```bash
# 인프라 (Cloud SQL·GCS·BigQuery·Secret·IAM)
cd infra && pulumi up

# 이미지 빌드 (Cloud Build)
gcloud builds submit --config cloudbuild-backend.yaml --project cso-ai   # 게이트웨이/프로세서 공용
gcloud builds submit --config cloudbuild-portal.yaml  --project cso-ai   # 포털

# Cloud Run 배포 — 게이트웨이/프로세서는 같은 이미지, --command 로 진입점 선택
#   프로세서: node dist/server.js   게이트웨이: node dist/gateway.js
```

도메인 매핑은 CNAME → `ghs.googlehosted.com`(서울 리전은 도메인 매핑 미지원 → 도쿄 사용).

## 라이선스

프로젝트 코드: MIT. 의존성은 모두 퍼미시브(Apache-2.0 / MIT): `sharp`, `@google-cloud/vertexai`, `google-auth-library`, `@prisma/client`, `next`, `csv-parse` 등.

> 약가·제약사 마스터 데이터의 이용허락 범위는 판매 전 별도 확인이 필요합니다([docs/PLATFORM-PLAN.md](docs/PLATFORM-PLAN.md) 참고).
