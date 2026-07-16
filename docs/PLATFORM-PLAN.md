# API 판매 플랫폼 구축 계획 (detect-hira-code 기반)

> 작성일: 2026-07-15
> 상태: 설계 확정 진행 중 (일부 오픈 결정 존재 — 문서 끝 §16 참조)
> 대상: HIRA 약가코드 검출 API를 첫 상품으로, **여러 API를 판매하는 플랫폼**으로 확장

---

## 1. 배경과 목표

- 현재 자산: `detect-hira-code` — 처방전/EDI 이미지에서 HIRA 약가코드(9자리)를 Gemini OCR로 검출하고, 마스터 데이터로 제약사명을 조회해 ① 태깅 이미지 생성(`lambda.handler`) ② JSON 추출(`lambda-extract.handler`)하는 도구.
- 최초 요구: "이 Lambda를 AWS 마켓플레이스에 판매".
- **진화한 목표**: 단일 API 판매가 아니라, **여러 API를 크레딧 기반으로 파는 플랫폼**을 구축한다. HIRA 검출 API는 그 위의 첫 번째 상품(product)일 뿐이다.

### v1 스코프
- 첫 상품 = **이미지 → 이미지 태깅** (`lambda.handler` 경로). 출력에 사업자번호 불필요 → `manufacturer_master` 제외, `drug_master`(약가코드→제약사명)만 사용.

---

## 2. 핵심 의사결정 로그 (근거 포함)

| # | 결정 | 근거 |
|---|---|---|
| D1 | **판매 채널: 직접 B2B 계약 우선, 마켓플레이스는 나중 옵션** | 파트너가 "둘 다/상관없음, 직접계약 가능"으로 답 → 마켓플레이스 결제연동(metering/KYC)이 필수 아님 |
| D2 | **호스팅: AWS Lambda → GCP Cloud Run 전환** | OCR이 Google Vertex 의존 → 콜로케이션(egress/지연 0). Cloud Run이 Lambda의 여러 제약(6MB 응답·API GW 29초·22MB CSV cold start)을 제거 |
| D3 | **OCR 엔진: Google Vertex Gemini 3.x 유지, 국외이전은 계약·약관 명시** | Bedrock 서울 in-region 실측 결과 bbox 부정확(아래 §6). 태깅엔 Gemini 필수. B2B라 위수탁계약+고지로 국외이전 처리 |
| D4 | **멀티 프로덕트 플랫폼** | 여러 API를 계속 판매할 계획 → 컨트롤 플레인(과금·인증·이력·어드민) 공유 + 프로덕트 플레인(API별 프로세서) 분리 |
| D5 | **과금: 크레딧(원) 지갑, 프로덕트별 가격, 200원 기본** | HIRA=200원. API마다 가격/무료쿼터/단위 어드민 설정. 원단위 수동충전(어드민이 입금 확인 후) |
| D6 | **DB: Cloud SQL micro(과금 원장) + BigQuery(호출이력)** | 원장은 ACID 필요→Postgres. 이력은 append-only→BigQuery(저렴). Neon은 GCP 밖(AWS/Azure)이라 크로스클라우드 → 올-GCP 위해 Cloud SQL 선택 |
| D7 | **큐: Cloud Tasks** | nadoo-ocr의 Redis+BullMQ 패턴을 서버리스 관리형으로 대체. dispatch rate로 Vertex 과부하 방어 |
| D8 | **NAT/VPC 커넥터 안 씀** | Cloud Run 네이티브 Cloud SQL 소켓 + Google API 직접 도달로 충분. VPC 커넥터 붙이면 불필요한 Cloud NAT 월 $32 고정비 발생 |

---

## 3. 판매 가능성 게이트 (feasibility)

| 게이트 | 상태 | 비고 |
|---|---|---|
| 직접 B2B 계약 판매 | 🟢 | 마켓플레이스 없이 가능 |
| 개인정보/국외이전 | 🟢 | 출력=구매자 자기 이미지 가공. 이미지 무저장. 국외이전은 위수탁계약 명시. 법인 사업자번호는 개인정보 아님 |
| OCR 엔진 | 🟢 | Vertex Gemini 확정(테스트 검증) |
| 보안 위생 | 🟡 | `vertex.txt`/`.env` 자격증명 흔적 → 판매 전 로테이션·제거 |
| **약가 데이터 라이선스** | 🟢 **해결(2026-07-15)** | **공공누리 제1유형(출처표시) + CC BY** → 상업 이용 OK. 아래 §3.1 |

### 3.1 약가 데이터 라이선스 — 해결됨 ✅
- **`drug_master_merged.csv`는 우리 자체 데이터(사내 제작·병합 자산)** — 주 소스이며 교체 대상 아님.
- 우리 데이터에 포함된 **심평원 공공데이터 부분의 라이선스 = 공공누리 제1유형(출처표시) + CC BY** → **상업적 이용·재서빙 OK.**
- **의무 2가지**:
  1. **출처표시**: 제품 내(문서/푸터/응답 메타)에 `출처: 건강보험심사평가원, 공공누리 제1유형` 표기.
  2. **제3자 권리 유의**("제3자 권리 포함" 표시): 제약사명 등 상표성 요소는 **제품 식별용(지시적)** 으로만 사용, 우리 브랜드처럼 사용 금지.
- **약가기준정보조회서비스**(data.go.kr `15054445`)는 **마스터에 없는 신규 코드용 fallback** (주 소스 아님). 조회 결과는 write-through로 우리 데이터에 캐시. 트래픽: 개발 1,000/일·운영 10만/일 — fallback 전용이라 여유.
  - **✅ 활성화(2026-07-16)**: `dgamtCrtrInfoService1.2/getDgamtList`(필드 `mdsCd`/`mnfEntpNm`/`itmNm`), 서비스키는 Secret Manager `hira-api-key`. `master.lookupDrug` 미조회 시 조회→`DrugMaster(source=hira-api)` write-through. fail-safe(오류 시 무동작).
- **⚠️ 잔여 확인(판매 전 게이트) — 미완**: (1) `drug_master_merged` 병합에 쓴 상위 소스 중 상업 제한(제2/4유형·별도 계약) 데이터 혼입 여부 1회 점검. (2) 15054445 fallback 결과의 **상업적 재서빙 이용범위** 재확인. 상단 "해결" 표기는 자체 데이터(`drug_master_merged`) 기준이며, 위 두 건(병합 소스·fallback 이용범위)은 별도 열린 게이트.

---

## 4. 아키텍처 개요 — 컨트롤 플레인 vs 프로덕트 플레인

```
┌─ 컨트롤 플레인 (공유 인프라, 한 번만 구축) ──────────────────┐
│  인증 · API키 · 크레딧 지갑(원) · 과금엔진 · 호출이력       │
│  · 어드민(프로덕트/가격/충전/신청/코마케팅) · 랜딩 카탈로그  │
└──────────────────────────────────────────────────────────────┘
        │  프로덕트-무관 미들웨어:
        │  키검증 → Entitlement → 가격조회 → [원자 차감] → 프록시 → 로깅
        ▼
┌─ 프로덕트 플레인 (API마다 1개, 계속 추가) ──────────────────┐
│  [hira-detect]   Cloud Run ─ detect-hira 파이프라인 ─ Vertex │  ← 상품 #1
│  [future-api-x]  Cloud Run ─ 임의 백엔드                     │  ← 상품 #2 (나중)
│  [future-api-y]  Cloud Run ─ ...                             │
└──────────────────────────────────────────────────────────────┘

의존 서비스:
  Cloud SQL(Postgres)  ← 잔액·원장·API키·프로덕트·코마케팅 (ACID)
  BigQuery             ← 호출이력 (저렴한 append, productId 포함)
  Cloud Tasks          ← 벌크 큐 (프로덕트별 dispatch rate)
  GCS (또는 R2)        ← 이미지 입출력
  Vertex Gemini        ← OCR (프로덕트별 백엔드 예시)
```

- **"람다처럼 배포"** = 각 프로덕트가 독립 배포·독립 스케일되는 **Cloud Run 서비스**. 앞단 게이트웨이(컨트롤 플레인)는 공유.
- 과금·인증·이력·어드민은 프로덕트와 무관하게 한 번만 구축. **새 API = 프로덕트 등록 + 프로세서 Cloud Run 배포**.

---

## 5. nadoo-ocr 재사용 맵

`~/workspaces/nadoo-ocr` = pnpm/turborepo 모노레포. 참고·재사용 대상.

| 요소 | nadoo-ocr 현황 | 우리 재사용 |
|---|---|---|
| 모노레포 | pnpm + turbo (`ocr-api`/`ocr-portal`/`ocr-worker`) | ✅ 뼈대 그대로 |
| API | **NestJS 11**, `/api/v1`, NextAuth v5 JWE 인증 가드 | ✅ 재사용, OCR 로직 교체 |
| Portal | **Next.js 16** + Radix UI + Tailwind | ✅ 랜딩·대시보드·어드민 추가 |
| DB/ORM | **Postgres + Prisma**, `Document` 단일 테이블 | ✅ 스키마 확장 |
| 저장소 | S3/MinIO 이중모드 | → **GCS** |
| **비동기/병렬 처리** | **BullMQ(Redis) + python-arq**, `max_jobs=5` 동시성, `max_tries=3`, `job_timeout=600s`, 상태 `UPLOADED→PROCESSING→COMPLETED/FAILED`, HTTP 콜백 진행보고 | ✅ **핵심 참고 → Cloud Tasks로 대체** |
| 과금/크레딧/API키/어드민 | **전무 ❌** | 🆕 신규 구축(핵심) |

### nadoo-ocr 병렬/벌크 패턴 (참고 근거)
- Backend가 업로드 수신 → 저장소 PUT → DB 레코드 생성(UPLOADED) → 워커 제출.
- 두 경로 공존: ① 직접 제출(`submitToWorker`, 상태 PROCESSING→결과, 500=재시도/4xx=실패) ② **큐 기반**(BullMQ→python-arq, 동시성 상한 `max_jobs=5`, 재시도 `max_tries=3`, 진행 콜백).
- 교훈: **수용(accept)과 처리(process)를 큐로 분리 + 동시성 상한 + 재시도 + 상태전이 폴링**이 안정적 병렬/벌크의 핵심.

---

## 6. OCR 엔진 결정 근거 (Bedrock 테스트 결과)

국외이전을 없애려 **Bedrock 서울 리전(ap-northeast-2) in-region** 가능성 검증.

- 서울에서 cross-region 프로파일 없이 ON_DEMAND로 쓸 수 있는 비전 모델은 **`claude-3-5-sonnet-20240620`, `claude-3-haiku-20240307`** 뿐 (최신 모델은 전부 APAC `INFERENCE_PROFILE` → 국외이전 부활).
- **실측 결과** (한국의원 샘플, 코드 3건 기준값 658107190/210/480):
  - 코드 텍스트 검출: ✅ **완벽** (3건 정확), 3.2초, 저렴
  - **bounding box: 🔴 실패** — 박스가 실제 숫자 위치(상단 표) 아닌 페이지 중앙 여백에 찍힘. Claude는 `box_2d` 규약 미학습 → 좌표 grounding 약함.
- **결론**:
  - **태깅 제품(v1)엔 Bedrock 부적합** → Vertex Gemini 필수.
  - bbox 불필요한 **JSON 추출 전용 API**라면 Claude 3.5 서울 in-region으로 **국외이전 0** 가능 → 프라이버시 민감 고객용 프리미엄 옵션 여지.

---

## 7. 데이터 모델 (Prisma 확장 + BigQuery)

### 7.1 Postgres (Cloud SQL) — ACID 필요 영역

```
User            id, email, role(user|admin), createdAt          (NextAuth 재사용)
ApiKey          id, userId, keyHash, prefix, active, createdAt   (계정 단위 공용 키 — §16 결정)
Product         id, slug, name, priceKrw, billingUnit(call|image|page),
                freeQuota(기본10), processorUrl, status(active|beta|deprecated)   ★
Entitlement     id, userId, productId, enabled, freeUsed          ★계정×프로덕트 접근·무료소진
CreditAccount   userId, balanceKrw(int)                           ★지갑(원, 프로덕트 공용)
CreditTx        id, userId, deltaKrw(+충전/-과금), type(topup|charge|refund),
                productId(과금 시), unitPriceKrw(스냅샷), memo, adminId, createdAt  ★원장
AccessRequest   id, userId, productId, contact, expectedVolume, purpose,
                status(new|contacted|approved|rejected), createdAt  ★10회 초과 신청
CoMarketingMapping  id, drugCode(9자리), originalName, displayName,
                    active, memo, updatedBy, updatedAt              ★코마케팅 표기 오버라이드
ProductPriceHistory (선택) productId, priceKrw, effectiveFrom       ★가격 이력(감사용)
```

### 7.2 BigQuery — 호출이력 (저렴한 append)

```
api_call_log
  ts, userId, productId, apiKeyPrefix, requestId(idempotency),
  status(ok|fail|degraded), billableCount, costKrw(스냅샷),
  latencyMs, tokensIn, tokensOut, displayNamesApplied[], errorCode
```

- productId 파티션/클러스터 → 프로덕트별·전체 정산 한 쿼리.
- `costKrw`, `displayNamesApplied`는 **호출 시점 스냅샷** 기록 → 나중에 가격/코마케팅 매핑이 바뀌어도 과거 정산·감사 무결.

---

## 8. 요청 흐름 (과금·무료티어·동시성 안전)

### 8.1 단건 (동기)
```
POST /api/v1/{productSlug}/detect   (x-api-key, 이미지)
 1. API키 검증 (Postgres, 캐시)
 2. Entitlement 확인 (해당 프로덕트 접근 가능?)
 3. Product.priceKrw / billingUnit 조회
 4. [원자 트랜잭션]
      freeUsed < freeQuota ? → 무료 처리 + freeUsed++
      : balanceKrw >= price ? → balanceKrw -= price, CreditTx(charge, unitPriceKrw 스냅샷)
      : → 402 (신청폼 안내)
 5. 프로덕트 프로세서(Cloud Run) 프록시 → OCR 처리 → 결과
 6. 실패 시 환불(CreditTx refund) — idempotency key로 이중과금 방지
 7. BigQuery 호출이력 append (비동기, productId·costKrw 스냅샷 포함)
```

### 8.2 동시성 안정성 3대 방어 ("여러 호출 동시에" 요구)
1. **크레딧 차감 = DB 원자 트랜잭션** (`UPDATE ... WHERE balanceKrw>=price RETURNING`) → 병렬 경합에도 과금 정확.
2. **idempotency key** → 클라 재시도 이중과금 방지.
3. **백엔드 과부하 방어** → 동기 경로는 Cloud Run `max-instances`·concurrency 상한, 벌크는 Cloud Tasks dispatch rate. Cloud SQL은 **커넥션 풀러 + 인스턴스당 풀 1–2** 로 커넥션 고갈 방지.

---

## 9. 벌크/병렬 처리 (nadoo-ocr 패턴의 GCP판)

```
POST /api/v1/{productSlug}/bulk   (이미지 N장 or GCS prefix)
 → job 레코드 N개 생성(status=QUEUED), jobId들 즉시 반환
 → Cloud Tasks 큐에 N개 enqueue (프로덕트별 dispatch rate = Vertex QPS 상한)
 → 각 태스크 → 프로세서 Cloud Run 호출 → 처리 → 상태 COMPLETED/FAILED (재시도 내장)
 → 클라 GET /jobs/:id 폴링 (nadoo-ocr 상태전이 그대로)
```

- **Cloud Tasks dispatch rate 제한** = nadoo-ocr `max_jobs=5`의 관리형 대체. "동시에 많이 와도 백엔드 안 터지고 안정 처리"의 핵심.
- 과금은 **성공한 job(=billableCount) 단위**. 벌크 = 성공 건수 × priceKrw.
- (대안) Redis 익숙하면 Memorystore + BullMQ로 nadoo-ocr 코드 더 그대로 이식 가능.

---

## 10. 과금·크레딧 상세

- **가격**: 상수 아님 → `Product.priceKrw` (어드민 API별 설정). HIRA=200원, 다음 API는 다른 값.
- **단위**: `Product.billingUnit` (호출당/이미지당/페이지당). `cost = priceKrw × billableCount` → 벌크 자연 커버.
- **가격 스냅샷**: 차감 시 `CreditTx.unitPriceKrw`, `api_call_log.costKrw`에 당시 가격 기록. 어드민이 가격 바꿔도 과거 정산 무결. (선택 `ProductPriceHistory`로 이력화.)
- **지갑**: 원(KRW) 정수 단일 잔액, 프로덕트 공용.
- **수동 충전**: 어드민이 입금(계좌이체) 확인 → 어드민 패널에서 `+금액` 입력 → `CreditTx(topup)` + 잔액 증가.
- **무료 티어**: `Entitlement.freeUsed < Product.freeQuota(기본 10)` 면 무과금. 프로덕트마다 계정당 10회 무료.

---

## 11. 무료 초과 → 사용신청 → Teams 웹훅

```
무료 10회 소진 & 잔액 부족 → API 402 응답 (신청폼 URL 안내)
Portal /apply 폼 (연락처·예상 사용량·용도·대상 프로덕트)
 → AccessRequest 저장
 → Teams Incoming Webhook에 Adaptive Card POST (신청자·이메일·프로덕트·예상량)
어드민 확인·연락·입금 수령 → 어드민 패널에서 수동 충전
```

---

## 12. 코마케팅(위탁판매) 표기 오버라이드

- 특정 약가코드는 코마케팅/위탁판매로 **실제 제약사와 다른 제약사명으로 표기**해야 함.
- **조회 계층 오버라이드**: `약가코드 → 마스터 조회(실제) → CoMarketingMapping 적용 → 표기명`.
  - 원본 마스터/공공API 데이터는 불변, **표기만 치환**.
  - **태깅 이미지 라벨 + JSON 추출 제약사명 둘 다 자동 적용** (동일 resolve 함수 경유).
- **어드민**: 매핑 CRUD + **CSV 벌크 임포트**(수십~수백 코드 대비) + 활성/비활성 토글.
- **감사**: 호출이력에 실제 표기한 `displayName` 기록.
- **적용 범위(scope)** — §16 오픈 결정:
  - (A) 전역(권장): 모든 고객 동일 표기. 코마케팅은 객관적 상거래 사실.
  - (B) 고객별: `tenantId` 컬럼 추가해 (고객, 코드) 단위.

---

## 13. 어드민 패널 (신규)

- **프로덕트 관리(CRUD)**: slug·가격(priceKrw)·단위(billingUnit)·무료쿼터·processorUrl·상태
- **수동 충전**: 유저 선택 → 원 금액 입력 → CreditTx(topup)
- **유저 관리**: 잔액·무료사용횟수·최근 호출량·Entitlement
- **사용신청 관리**: AccessRequest 목록·상태
- **코마케팅 매핑**: CRUD + CSV 임포트
- **호출이력/정산**: BigQuery 쿼리, 프로덕트별·월별 매출/사용량

---

## 14. 랜딩 (Cloud Run + Next.js)

- **API 카탈로그형** — 단일 제품 소개가 아니라 Product 목록을 렌더 (새 API 추가 시 자동 노출).
- 프로덕트별: 설명·가격(예: 200원/호출)·무료 10회·API 문서·가입/키 발급.
- Cloud Run에 Next.js 컨테이너 배포로 간단히 구현.

---

## 15. 인프라 & 비용

### 15.1 DB 선택 근거
- **과금 원장**: Postgres 필요(ACID). **Cloud SQL micro(~$10/월)** — 올-GCP·인리전(서울)·네이티브 소켓. Neon($0 floor)은 **GCP 밖(AWS/Azure)**이라 크로스클라우드 → 제외. $10은 매출 대비 무시 가능(1만 호출 매출의 0.7%).
  - 커넥션 고갈 방지: **관리형 풀러 + Cloud Run 인스턴스당 풀 1–2 + max-instances 상한**.
- **호출이력**: **BigQuery** — append 저렴(~$0.02/GB), 정산 집계 최적.
- **이미지**: GCS(기본) 또는 R2(대량 서빙 시).
- **큐**: Cloud Tasks (Memorystore 고정비 회피).

### 15.2 NAT/VPC — 안 씀 (고정비 회피)
- Cloud Run 네이티브 Cloud SQL 소켓(public IP + IAM) → VPC 커넥터·NAT 불필요.
- Vertex/BigQuery/GCS는 Google API라 백본 직접 도달 → NAT 불필요.
- 인바운드(업로드) **무료**.
- ⚠️ VPC 커넥터 붙이면 외부 트래픽이 NAT를 안 타도 **Cloud NAT 월 ~$32 + $0.045/GB** 부과 → **커넥터 붙이지 않는 게 최적화**. 정적 아웃바운드 IP 필요 시에만 NAT.

### 15.3 Egress 최적화
- GCP 인터넷 egress $0.12/GB(첫 1TB). 결과 이미지 반환이 유일한 네트워크 비용.
- 최적화: ① 전처리로 이미지 축소(기존) ② 결과를 **서명 URL**로 반환(inline base64 지양) ③ 대량 서빙 시 결과 저장소만 **Cloudflare R2(egress $0)**로 수술적 전환.

### 15.4 총 예상비용 (gemini-3.1-flash-lite, ~5,300토큰/이미지, 결과 1.5MB, 200원≈$0.15/호출)

| 항목 | 1만 호출/월 | 10만 호출/월 |
|---|---|---|
| Cloud SQL micro | ~$10 | ~$10 |
| Cloud Run (scale-to-zero) | ~$3 | ~$25 |
| Vertex Gemini (flash-lite) | ~$15–30 | ~$150–300 |
| Egress(이미지) | ~$2 | ~$18 |
| BigQuery/GCS/Cloud Tasks | <$2 | ~$5 |
| **합계** | **≈ $30–50** | **≈ $210–360** |
| **매출(200원×)** | **≈ $1,500** | **≈ $15,000** |

→ 비용은 매출의 **2~3%**. 마진 97%+. 고정비 floor(Cloud SQL) + Vertex가 주 변수지만 매출 대비 작음.

### 15.5 Cloudflare 배포 분석
| 관점 | Cloudflare | 판정 |
|---|---|---|
| Egress | R2·D1·Queues **egress $0** | ✅ 대량 이미지 서빙 시 압도적 |
| DB floor | D1 서버리스(floor 없음) | ✅ |
| Workers | $5/월(1천만 요청) | ✅ 저렴 |
| **Sharp(이미지 태깅)** | Workers(V8)에서 **네이티브 libvips 실행 불가** | 🔴 **블로커** |
| OCR | 어차피 Vertex(Google) | ➖ 동일 |

- **통짜 Cloudflare 이전 ❌** (Sharp 때문). Cloudflare Containers는 신규·미성숙.
- **현실적 최적**: GCP Cloud Run(Sharp+Vertex) + **결과 저장/서빙만 R2**(egress 0) 수술적 취득.

---

## 16. 오픈 결정 (확정 필요)

| # | 항목 | 옵션 | 기본 권장 |
|---|---|---|---|
| O1 | **API 키 범위** | 계정 단위 공용 키 vs 프로덕트별 키 | ✅ **계정 단위 공용 확정** (2026-07-15) |
| O2 | **큐** | Cloud Tasks vs Memorystore+BullMQ | ✅ **Cloud Tasks 확정** (2026-07-15) — 고정비 0, 월 100만 작업 무료 |
| O3 | **호출이력 DB** | BigQuery vs Firestore | ✅ **BigQuery 확정** (2026-07-15) — 고정비 0, 저장 10GB·쿼리 1TB/월 무료 |
| O4 | **코마케팅 scope** | 전역 vs 고객별(tenantId) | ✅ **전역 확정** (2026-07-15) — 모든 고객 동일 표기 |
| O5 | **약가 데이터 라이선스** | — | ✅ **해결 확정** (2026-07-15) — 공공누리 제1유형(출처표시)+CC BY, 상업 OK |

---

## 17. 단계별 구축 계획

| 단계 | 내용 | 산출물 |
|---|---|---|
| **0. 이식** | detect-hira 파이프라인 → Cloud Run 프로세서(#1), S3→GCS | 작동하는 OCR 서비스 |
| **1. 컨트롤 플레인** | Prisma 스키마(Product·Entitlement·ApiKey·CreditAccount·CreditTx), 키 발급/검증, **프로덕트별 가격/무료쿼터** 원자 차감 | 유료 API 동작 |
| **2. 호출이력** | BigQuery append(productId·스냅샷) + 조회 | 정산 가능 |
| **3. 벌크** | Cloud Tasks(프로덕트별) + job 상태 폴링 | 안정적 병렬/벌크 |
| **4. 신청·어드민** | 신청폼→Teams 웹훅, 어드민 수동충전·유저·프로덕트 CRUD·**코마케팅 매핑/CSV** | 운영 가능 |
| **5. 랜딩** | API 카탈로그 랜딩(가격·무료·문서·가입) | 판매 개시 |

---

## 18. 판매 전 필수 정리 (보안 위생)
- `vertex.txt`, `.env`의 자격증명 → **로테이션 + git 히스토리 제거**.
- 서비스 계정 최소 권한(Vertex, GCS, BigQuery, Cloud SQL) 분리.
