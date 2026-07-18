# hira-extract 개선 · 배포 계획

EDI 이미지 → 크롭 → 약품별 숫자컬럼 추출·검증(hira-extract, BETA). 전수 검증(edi-data 83장) 기반 개선 궤적과 서버리스(Cloud Run) 배포 계획.

## 0. 원칙 (사용자 확정)
- **OCR = 정본**: 이미지에서 읽은 값이 결과. 마스터·산술은 검증에만(값 대체·환각 금지).
- **전체 표 전 행** 추출. 약가코드 비표준(대학병원 자체코드 등)이어도 **약품명·숫자는 제공**하고 라인별 확인 표시.
- **RED = 값(숫자) 오류만**, YELLOW = 확인 필요하나 숫자 정상, GREEN = 검증 통과.
- API별(detect/extract) 응답·문서·데모 **분리**.

---

## 1. 개선 계획

### 1.1 반영 완료
| 영역 | 내용 |
|---|---|
| 프롬프트 v3 | 전체행·약품명필수·코드원문(환각금지)·자릿수보존·합계제외·중복금지 |
| 숫자 파싱 | 점=천단위(3자리)/소수점(1~2자리) 컬럼 무관, `, .` 로케일 인식 |
| 컬럼 매핑 | 수량/처방횟수/총투여량 의미 분리, 순번·단위 ignore, 헤더 괄호 제거 |
| 행 정리 | 합계/제약사소계/빈행/중복 환각행 제거 |
| 신호등 재정의 | RED=산술 불일치만, 코드이슈·단가불일치(산술OK)→YELLOW |
| 마스터 단가 검증 | 단가 미기재라도 마스터 단가×수량≈총금액 통과 시 GREEN |
| 계층형 재추출 | lite 기본 + 산술불일치 행만 3.5-flash 밴드 재추출(EXTRACT_RECROP_MODEL) |
| 회전·크롭 폴백 | Gemini 회전보정, 크롭 실패 시 원본 재시도, image_quality 판정 |
| 문서유형 분류 | 비-약품(사업자등록증 등) triage |
| 마스터 폴백 | data.go.kr 조회 → DrugMaster write-through(source=hira-api), 동시성·재시도 견고화 |
| 미조회 코드 로깅 | UnresolvedDrugCode(dedup) + 어드민 검토 |

**정량 효과(edi-data 83장 재생성)**:

| 버전 | 행 | GREEN | YELLOW | RED | 산술통과 |
|---|---|---|---|---|---|
| v1 (초기) | 667 | 180 | 257 | 230 | 88% |
| v5 (파싱·프롬프트) | 716 | 427 | 69 | 220 | 88% |
| **v6 (전 개선)** | 716 | **454** | 182 | **80** | 89% |

→ GREEN 2.5배(180→454), **RED −65%(230→80, 진짜 산술오류만 잔존)**. 코드이슈·단가불일치(산술OK)가 RED→YELLOW로 정확히 이동.

### 1.2 남은 개선 (우선순위)
1. **잔존 RED(진짜 산술오류 ~97)**: 자릿수 절단·컬럼 시프트·오독. → 계층형 3.5-flash 재추출을 정산 경로에서 상시 on. bench로 lite vs 3.5-flash 정확도·원가 재측정.
2. **코드 환각 억제**: 단축코드→9자리 패딩(예 6535→653500000). 프롬프트 v3로 완화됐으나 flash-lite 잔존 → 3.5-flash 또는 후처리(마스터 미조회 9자리 중 끝 000패턴 경고).
3. **HIRA_FIELD_PRICE 검증**: data.go.kr 상한금액 필드명 확정(현재 단가 null 가능). 단가 정본은 급여목록 xlsx.
4. **완전성(P3) 튜닝**: 합계 대조로 누락 감지 → 누락 시 원본 전체 재추출 트리거.
5. **촬영 왜곡 심한 데이터(별도 트랙)**: 사용자 제공 ~1만장으로 dewarp/컬럼복원 독립 연구(파이프라인 전처리 훅만 개방).

### 1.3 정확도 운영 모드
- **대량 사전추출(GT/모니터링)**: flash-lite + lite recrop(빠름/저렴).
- **정산(정확도 critical)**: flash-lite + **산술불일치 행 3.5-flash 밴드 재추출**(lite 섞기). 라인별 신호등·확인필요로 HITL.

---

## 2. 배포 계획 (Cloud Run 서버리스)

AWS Lambda 대체 = **Cloud Run**(컨테이너 서버리스, 요청당 오토스케일, scale-to-zero). 로컬 단일 크롭 서버의 직렬 병목이 수평 확장으로 해소.

### 2.1 구성 요소 · 서버리스 설정
| 서비스 | 런타임 | Cloud Run 설정(권장) | 리전 |
|---|---|---|---|
| **crop-svc** (RT-DETR ONNX) | Python FastAPI | `--concurrency 1~2 --cpu 2 --memory 2Gi --min-instances 1 --max-instances 50` | asia-northeast3 |
| **processor** (extract) | Node | `--concurrency 20~40 --max-instances N`, 비공개 | asia-northeast3 |
| **gateway** | Node | `--concurrency 40 --max-instances N`, 공개 | asia-northeast1 |
| **portal** | Next.js | 기존 | asia-northeast1 |
| **db-migrate** | Cloud Run Job | release 시 1회 | — |

- crop-svc는 CPU 바운드(ONNX) → concurrency 낮게·max-instances 크게(50개 동시 크롭=50 인스턴스). min-instances 1로 콜드스타트(모델 로드 수초) 완충.
- processor는 Gemini 대기(I/O) → concurrency 높게.
- 진짜 병목은 **Vertex Gemini 쿼터** → 쿼터 상향 + Cloud Tasks 큐 backpressure(§7).

### 2.2 대량 비동기 (수천 장, §7)
`POST /extract-batch-async` → Job/JobItem 생성 + **Cloud Tasks** enqueue → 워커(`/internal/process-item`)가 병렬 처리(Cloud Run 오토스케일). `GET /jobs/{id}` 폴링(진행률·신호등 집계). 대량은 presigned GCS 업로드 권장.

### 2.3 배포 절차
1. **크롭 모델 export**: `edi-img-crop-rt-detr`에서 `make export`(HF→ONNX, models/ 채움).
2. **crop-svc 배포**: `gcloud run deploy edi-table-crop-svc --source . --dockerfile service/Dockerfile --region asia-northeast3 --no-allow-unauthenticated ...`
3. **processor env 주입**: `CROP_SERVICE_URL=<crop-svc run.app>`, `EXTRACT_RECROP_MODEL=gemini-3.5-flash`(정산) 또는 lite(대량).
4. **DB migration**: release-* 태그 → db-migrate Job(펜딩만 적용). 신규 마이그레이션 7종(edi_extract·drug_price_history·price_status·document_type·image_quality·unresolved_drug_code) 포함.
5. **Product 시드**: `seed:extract`(hira-extract BETA), `seed:drug-prices`(상한금액표 xlsx), 프롬프트 템플릿 v3.
6. **Cloud Tasks 큐** 생성 + gateway env(`CLOUD_TASKS_QUEUE·WORKER_URL·CLOUD_TASKS_SA·WORKER_SECRET`).
7. **시크릿**: `hira-api-key`(data.go.kr), Vertex 자격, `internal-api-secret` 등.

### 2.4 CI/CD
- 기존 `cloudbuild-release.yaml`에 **crop-svc 이미지 빌드·배포 추가**(별도 리포라 트리거 분리 또는 서브모듈).
- release-* 태그 → 이미지 3종(processor/portal/db-migrate) + crop-svc 배포.
- 크롭 모델(LFS/ONNX 167MB)은 빌드 컨텍스트에 포함 or GCS에서 pull.

### 2.5 관측·비용
- **원가 추적**: UsageCost(단계별 model/토큰/원가) → 어드민 `/admin/costs` 마진(매출−원가).
- **모델 비용 게이트**: 3.5-flash는 정산 경로 산술불일치 행만(밴드 재추출) → lite 대비 소폭 증가.
- Cloud Monitoring: 큐 적체·인스턴스 수·429/5xx·crop-svc latency 알람.

---

## 3. 배포 게이트 (남은 것)
1. 크롭 모델 export + Cloud Run 배포 + `CROP_SERVICE_URL` 주입.
2. 운영 DB migration/seed(로컬 완료, 운영 파이프라인).
3. Vertex Gemini 쿼터 상향(대량 목표 처리량 기준).
4. `HIRA_FIELD_PRICE` data.go.kr 실필드 검증(단가 보강).
5. 약가 데이터 이용허락범위(마켓 판매) — [[marketplace-plan]].
6. 정확도 목표 확정 후 정산 경로 3.5-flash on/off 정책 결정(원가 vs 정확도).
