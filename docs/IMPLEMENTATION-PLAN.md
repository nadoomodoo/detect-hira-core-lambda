# 구현 상세 계획

> 작성일: 2026-07-15
> 상위: [PLATFORM-PLAN.md](./PLATFORM-PLAN.md) (아키텍처·결정) · [UI-UX-PLAN.md](./UI-UX-PLAN.md) (UI) · [design.md](../design.md) (디자인 표준)
> 목적: 위 계획을 **바로 착수 가능한 수준의 엔지니어링 스펙**으로 상세화

---

## 1. 리포 구조 (nadoo-ocr 모노레포 계승)

pnpm + turborepo. `~/workspaces/nadoo-ocr` 구조를 계승하되 플랫폼용으로 재편.

```
apis-platform/                    (또는 기존 detect-hira-code를 흡수)
  package.json (pnpm workspace)  turbo.json
  packages/
    api/          @platform/api        NestJS 11 — 컨트롤 플레인(인증·키·크레딧·과금·프록시)
    portal/       @platform/portal     Next.js 16 — 고객 프론트 + /admin
    processor-hira/  @platform/processor-hira  Cloud Run — detect-hira 파이프라인(#1 프로덕트)
    shared/       @platform/shared     공용 타입·Prisma client·과금 로직·상수
  infra/        @platform/infra    Pulumi (TypeScript) — SQL·BQ·Tasks·IAM·Secret·Cloud Run
    index.ts    스택 정의   Pulumi.yaml   Pulumi.<stack>.yaml
    cloudrun/   서비스별 Dockerfile
  docs/
```

- 새 프로덕트 = `packages/processor-<slug>/` 추가 + Cloud Run 배포 + `Product` 등록. 컨트롤 플레인 무수정.
- `shared`에 과금 엔진·Prisma·타입을 두어 api/portal이 공유.

---

## 2. 기술 스택 (확정)

| 레이어 | 선택 |
|---|---|
| API | NestJS 11, `/api/v1`, global prefix |
| Portal/Admin | Next.js 16 App Router, Tailwind + Radix + lucide (design.md 프리미티브) |
| 인증 | NextAuth v5 (Google) — 고객 광범위, 어드민 `hd=nadoomodoo.com`+role |
| ORM/DB | Prisma + **Cloud SQL Postgres**(과금 원장) |
| 이력 | **BigQuery** (배치 로드) |
| 큐 | **Cloud Tasks** |
| 저장소 | GCS (결과 이미지, 서명 URL) |
| OCR | Vertex Gemini 3.x (`processor-hira` 내부) |
| 이미지 | sharp (processor 내부, Node 런타임) |
| IaC | **Pulumi (TypeScript)** — 모노레포와 동일 언어, `@platform/infra` |
| 배포 | Cloud Run (서비스별), 서울 `asia-northeast3` |

---

## 3. 환경변수 매트릭스 (서비스별)

| 변수 | api | portal | processor-hira | 설명 |
|---|:--:|:--:|:--:|---|
| `DATABASE_URL` | ✅ | ✅ | | Cloud SQL 소켓 커넥션 |
| `NEXTAUTH_SECRET` / `AUTH_SECRET` | ✅ | ✅ | | JWE 서명 |
| `GOOGLE_CLIENT_ID/SECRET` | | ✅ | | OAuth |
| `ADMIN_HD` | ✅ | ✅ | | `nadoomodoo.com` |
| `BQ_DATASET` / `BQ_TABLE` | ✅ | | | 호출이력 |
| `TASKS_QUEUE` / `TASKS_LOCATION` | ✅ | | | Cloud Tasks |
| `GCS_RESULT_BUCKET` | ✅ | | ✅ | 결과 이미지 |
| `PROCESSOR_HIRA_URL` | ✅ | | | 프록시 대상(Product.processorUrl로도 관리) |
| `TEAMS_WEBHOOK_URL` | ✅ | | | 사용신청 알림 |
| `VERTEX_PROJECT_ID`/`VERTEX_LOCATION`/`GOOGLE_APPLICATION_CREDENTIALS_JSON` | | | ✅ | Vertex (global) |
| `MODEL_NAME`/`OCR_FALLBACK_MODEL` | | | ✅ | Gemini 모델 |
| `DRUG_MASTER_PATH`/`HIRA_API_KEY` | | | ✅ | 마스터 + 약가 fallback API |

시크릿은 **Secret Manager**로 주입. `vertex.txt`/`.env` 평문 자격증명은 폐기·로테이션(§14).

---

## 4. DB 스키마 (Prisma)

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  role          Role     @default(USER)
  createdAt     DateTime @default(now())
  apiKeys       ApiKey[]
  credit        CreditAccount?
  entitlements  Entitlement[]
  creditTxs     CreditTx[]
  accessReqs    AccessRequest[]
  @@index([role])
}
enum Role { USER ADMIN }

model ApiKey {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  keyHash    String   @unique          // SHA-256(secret) — 원문 미저장
  prefix     String                    // 표시용 앞 8자 (예: pk_live_xxxx)
  active     Boolean  @default(true)
  lastUsedAt DateTime?
  createdAt  DateTime @default(now())
  @@index([userId]) @@index([active])
}

model Product {
  id           String        @id @default(cuid())
  slug         String        @unique     // hira-detect
  name         String
  priceKrw     Int                       // 호출 시점 스냅샷 대상
  billingUnit  BillingUnit   @default(CALL)
  freeQuota    Int           @default(10)
  processorUrl String
  status       ProductStatus @default(ACTIVE)
  updatedAt    DateTime      @updatedAt
  entitlements Entitlement[]
  priceHistory ProductPriceHistory[]
}
enum BillingUnit { CALL IMAGE PAGE }
enum ProductStatus { ACTIVE BETA DEPRECATED }

model ProductPriceHistory {
  id            String   @id @default(cuid())
  productId     String
  product       Product  @relation(fields: [productId], references: [id])
  priceKrw      Int
  effectiveFrom DateTime @default(now())
  @@index([productId, effectiveFrom])
}

model Entitlement {
  id        String  @id @default(cuid())
  userId    String
  productId String
  enabled   Boolean @default(true)
  freeUsed  Int     @default(0)        // 원자 증가
  user      User    @relation(fields: [userId], references: [id])
  product   Product @relation(fields: [productId], references: [id])
  @@unique([userId, productId])
}

model CreditAccount {
  userId    String   @id
  user      User     @relation(fields: [userId], references: [id])
  balanceKrw Int     @default(0)       // 원자 차감 (>=0 보장)
  updatedAt DateTime @updatedAt
}

model CreditTx {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  deltaKrw     Int                      // +충전 / -과금 / +환불
  type         TxType
  productId    String?                  // 과금/환불 시
  unitPriceKrw Int?                     // 가격 스냅샷
  requestId    String?  @unique         // idempotency (과금 1건=1행)
  memo         String?
  adminId      String?                  // topup 처리자
  createdAt    DateTime @default(now())
  @@index([userId, createdAt])
}
enum TxType { TOPUP CHARGE REFUND }

model AccessRequest {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  productId     String
  contact       String
  expectedVolume String?
  purpose       String?
  status        ReqStatus @default(NEW)
  createdAt     DateTime @default(now())
  @@index([status, createdAt])
}
enum ReqStatus { NEW CONTACTED APPROVED REJECTED }

model CoMarketingMapping {          // 전역 적용
  id           String   @id @default(cuid())
  drugCode     String   @unique      // 9자리
  originalName String?
  displayName  String
  active       Boolean  @default(true)
  memo         String?
  updatedBy    String?
  updatedAt    DateTime @updatedAt
  @@index([active])
}

model DrugMaster {                   // 약가코드→제약사 마스터 (어드민 관리 DB화)
  drugCode         String   @id       // 9자리
  manufacturerName String
  drugName         String?
  source           String   @default("seed")  // seed | hira-api | admin
  updatedAt        DateTime @updatedAt
  @@index([manufacturerName])
}
```

- **마스터는 파일 아님 → Postgres `DrugMaster` 테이블(어드민 관리).** 어드민에서 **CSV 업로드(벌크 임포트)** + 조회/편집(코마케팅과 동일 패턴). 초기 시드: 기존 21MB `drug_master_merged.csv` 1회 임포트. write-through fallback(약가 API miss)도 이 테이블에 upsert.
- `master.ts`는 파일 로드 → **Cloud SQL 조회**(cold start 시 Map 캐시). processor(`vertex-ocr@`, cloudsql.client)가 직접 조회.
- **결과 이미지 30일 후 자동 삭제**(버킷 TTL=30, 적용 완료) → **약관/개인정보 처리방침·랜딩 푸터에 "처리 이미지 30일 후 삭제" 고지 필수.**
- Vertex: 현재 **`prod-ai-model-478008`**(A안, 작동 검증됨). `VERTEX_PROJECT_ID` 환경변수라 cso-ai 이전은 교체만.

**핵심 무결성**: `CreditTx.requestId @unique` = idempotency. 잔액은 `CreditAccount.balanceKrw`를 조건부 `UPDATE`로만 변경(§8).

---

## 5. BigQuery 스키마 (호출이력)

```sql
CREATE TABLE platform.api_call_log (
  ts            TIMESTAMP    NOT NULL,
  request_id    STRING       NOT NULL,   -- idempotency 키와 동일
  user_id       STRING       NOT NULL,
  product_id    STRING       NOT NULL,
  api_key_prefix STRING,
  status        STRING       NOT NULL,   -- ok|fail|degraded
  billable_count INT64       NOT NULL,
  cost_krw      INT64        NOT NULL,    -- 스냅샷
  free_used     BOOL,                     -- 무료 차감 여부
  latency_ms    INT64,
  tokens_in     INT64,
  tokens_out    INT64,
  display_names ARRAY<STRING>,            -- 적용된 코마케팅 표기
  error_code    STRING,
  rotation      INT64
)
PARTITION BY DATE(ts)
CLUSTER BY product_id, user_id;
```

- 인제스트: api가 요청 종료 시 **배치 버퍼 → load job**(스트리밍 비용 회피). 실패해도 과금 원장(Postgres)이 정본.
- 정산: `SELECT product_id, SUM(cost_krw) ... WHERE ts BETWEEN ... GROUP BY product_id`.

---

## 6. API 계약 (`/api/v1`)

### 6.1 인증 헤더
- 판매 API: `x-api-key: pk_live_...`
- 대시보드/어드민 API: NextAuth 세션(JWE Bearer).

### 6.2 판매 — 단건
```
POST /api/v1/{slug}/detect
  x-api-key, Content-Type: image/* | application/json({image|imageUrl|inputBucket/Key})
  선택 헤더: Idempotency-Key
→ 200 { requestId, items[], uniqueManufacturers[], multiManufacturer,
        tagged, output:{url}|image(base64), width, height, rotation,
        cost:{krw, free:boolean}, balanceKrw }
→ 402 { error:"insufficient_credit", freeUsed, freeQuota, applyUrl }
→ 401 invalid_key   403 not_entitled   422 bad_image   502 processor_error
```

### 6.3 판매 — 벌크
```
POST /api/v1/{slug}/bulk
  { images[] | gcsPrefix }
→ 202 { batchId, jobs:[{jobId, status:"QUEUED"}] }

GET /api/v1/{slug}/jobs/{jobId}
→ 200 { jobId, status:QUEUED|PROCESSING|COMPLETED|FAILED, result?, cost?, error? }

GET /api/v1/batches/{batchId}
→ 200 { batchId, total, completed, failed, jobs[] }
```

### 6.4 대시보드
```
GET  /api/v1/me                      { user, balanceKrw }
GET  /api/v1/me/keys                 키 목록
POST /api/v1/me/keys                 → { key(1회 노출), prefix }
DELETE /api/v1/me/keys/{id}          폐기
GET  /api/v1/me/usage?product=&from=&to=&status=   (BigQuery)
GET  /api/v1/me/transactions         원장
POST /api/v1/me/apply                { productId, contact, expectedVolume, purpose } → Teams
```

### 6.5 어드민 (`role=ADMIN` + hd 게이트)
```
GET/POST/PATCH /api/v1/admin/products[/id]
GET  /api/v1/admin/users[/id]
POST /api/v1/admin/users/{id}/topup   { amountKrw, memo } → CreditTx(TOPUP)
GET/PATCH /api/v1/admin/requests[/id]
GET/POST/PATCH/DELETE /api/v1/admin/comarketing[/id]
POST /api/v1/admin/comarketing/import (CSV)
GET  /api/v1/admin/usage / settlement?month=
```

에러 포맷 통일: `{ error:code, message, ...ctx }`. 상태코드는 의미대로(401/403/402/422/429/5xx).

---

## 7. 인증·인가 구현

### 7.1 NextAuth Google + 어드민 hd 제한
```ts
// portal/auth.ts
callbacks: {
  async signIn({ account, profile }) {
    return !!profile?.email;               // 고객: 광범위 허용
  },
  async jwt({ token, profile }) {
    if (profile) {
      token.hd = (profile as any).hd;      // Google Workspace hosted-domain
      // role 은 DB(User.role)에서 결정
    }
    return token;
  },
}
// 어드민 승격 조건: token.hd === ADMIN_HD && User.role === 'ADMIN'
```
- ID 토큰 서명 검증(NextAuth 처리) + `hd` 클레임 + 이메일 도메인 재확인 + `User.role=ADMIN` 허용목록.

### 7.2 미들웨어 게이트
```ts
// portal/middleware.ts  — matcher: ['/admin/:path*']
if (path.startsWith('/admin')) {
  if (!(token?.hd === ADMIN_HD && token?.role === 'ADMIN')) return notFound(); // 존재 은닉
}
```

### 7.3 API 키 검증 (NestJS Guard)
- `x-api-key` → `sha256` → `ApiKey.keyHash` 조회(짧은 인메모리 캐시). `active` 확인 → `userId` 로드 → `lastUsedAt` 비동기 갱신.

---

## 8. 과금 엔진 (핵심 — 동시성 안전)

`shared/billing.ts`. **한 트랜잭션 + 조건부 UPDATE + idempotency**.

```ts
async function chargeForCall(userId, product, requestId): Promise<ChargeResult> {
  return prisma.$transaction(async (tx) => {
    // 0) idempotency: 이미 처리된 요청이면 그 결과 반환
    const dup = await tx.creditTx.findUnique({ where: { requestId } });
    if (dup) return { idempotentReplay: true, ... };

    // 1) 무료 티어 우선 (원자 증가, freeUsed < freeQuota 조건)
    const free = await tx.$executeRaw`
      UPDATE "Entitlement" SET "freeUsed" = "freeUsed" + 1
      WHERE "userId"=${userId} AND "productId"=${product.id}
        AND "freeUsed" < ${product.freeQuota}`;
    if (free === 1) {
      await tx.creditTx.create({ data:{ userId, deltaKrw:0, type:'CHARGE',
        productId:product.id, unitPriceKrw:0, requestId, memo:'free-tier' }});
      return { charged:false, free:true };
    }

    // 2) 유료 차감 (조건부 — 잔액 부족 시 0행)
    const price = product.priceKrw;
    const paid = await tx.$executeRaw`
      UPDATE "CreditAccount" SET "balanceKrw" = "balanceKrw" - ${price}
      WHERE "userId"=${userId} AND "balanceKrw" >= ${price}`;
    if (paid === 0) throw new InsufficientCreditError();

    await tx.creditTx.create({ data:{ userId, deltaKrw:-price, type:'CHARGE',
      productId:product.id, unitPriceKrw:price, requestId }});
    return { charged:true, free:false, unitPriceKrw:price };
  });
}
```

- **차감 후 처리 실패 시 환불**: `refund(requestId)` → `CreditTx(REFUND,+price)` + 잔액 복원 (환불도 idempotent: `requestId+':refund'`).
- **벌크**: job 성공 시점마다 `chargeForCall(..., jobRequestId)` 개별 호출 → 부분 성공도 정확 과금.
- **요청 흐름**: `키검증 → Entitlement → [chargeForCall] → processor 호출 → 실패면 refund → BigQuery 로그`.

---

## 9. 코마케팅 해석 통합

`shared/resolveManufacturer.ts` — 마스터 조회 결과를 표기명으로 변환. **태깅·추출 양쪽이 이 함수를 경유**.
```ts
function applyCoMarketing(code, resolvedName): { displayName, overridden } {
  const m = coMarketingCache.get(code);          // active 매핑만, 주기 리프레시
  return m ? { displayName:m.displayName, overridden:true }
           : { displayName: resolvedName, overridden:false };
}
```
- 전역 적용(O4). 표기명은 라벨 렌더 + JSON `manufacturer` 모두 반영.
- 적용된 `displayName`은 `api_call_log.display_names`에 스냅샷.

---

## 10. 벌크/큐 (Cloud Tasks)

- 큐 1개(초기) 또는 프로덕트별 큐. `maxDispatchesPerSecond`로 Vertex QPS 상한, `maxConcurrentDispatches`로 동시성 상한, `maxAttempts`로 재시도.
- `POST /bulk`: job 레코드(QUEUED) 생성 → 각 job을 Cloud Tasks에 enqueue(대상=processor 프록시 핸들러, payload=jobId+이미지참조).
- 태스크 핸들러: `PROCESSING` → processor 호출 → 성공 시 `chargeForCall`+`COMPLETED`, 실패 시 재시도/최종 `FAILED`.
- job 상태는 경량 테이블(또는 Firestore) — 폴링 `GET /jobs/{id}`. (job 상태 저장소는 §16 미세결정.)

---

## 11. detect-hira → `processor-hira` 포팅

기존 `src/` 파이프라인은 **클라우드 무관**이라 대부분 재사용. 변경 목록:

| 항목 | 현재(Lambda) | 변경 |
|---|---|---|
| 진입점 | `lambda.ts`/`lambda-extract.ts` | **Cloud Run HTTP 핸들러**(Express/Fastify), `POST /process` |
| 입력 | S3/base64/binary/URL | GCS 참조 + binary (API가 게이트웨이) |
| 출력 | 6MB 리밋 회피(base64 축소/`imageReduced`) | **삭제** — GCS PUT + 서명 URL 반환(리밋 없음) |
| 타임아웃 | API GW 29초 회피용 Function URL | Cloud Run 타임아웃 상향(최대 60분) |
| 마스터 | 22MB CSV cold-start 로드 | 우리 데이터 로드 + **약가 API fallback write-through**, min-instance로 웜 유지 |
| 제약사 해석 | 직접 | `applyCoMarketing` 경유(§9) |
| sharp | Lambda arm64 바이너리 | Cloud Run 컨테이너 네이티브 |

- `preprocess.ts`/`ocr.ts`/`annotate.ts`/회전·백오프·usage 집계 로직은 그대로.
- 응답에 `usageMetadata`(토큰) 포함 → api가 BigQuery 로그에 기록.

---

## 12. 배포

- **Cloud Run 서비스 3개**: `api`, `portal`, `processor-hira` (서울 `asia-northeast3`), 전부 scale-to-zero(processor는 min-instances=1 옵션으로 콜드스타트 완화).
- **Cloud SQL**(Postgres micro) + 커넥션 풀러, Cloud Run 네이티브 소켓(NAT 없음).
- **BigQuery** 데이터셋/테이블 부트스트랩(`infra/bigquery`).
- **Cloud Tasks** 큐 생성(`infra`).
- **Secret Manager**: DB URL, NextAuth secret, Google OAuth, Vertex creds, Teams webhook.
- **서비스 계정 분리(최소권한)**: api(SQL client, Tasks enqueuer, BQ dataEditor, GCS), processor(Vertex user, GCS, SQL read), portal(SQL client).
- **IaC(Pulumi TS)**: 상태성 리소스(Cloud SQL·BigQuery·Cloud Tasks·IAM·Secret·GCS·Cloud Run 서비스 정의)를 `@platform/infra`에서 관리(`pulumi up`). 서비스명·리전·큐명 등 상수를 앱 패키지와 공유. 스택 분리(dev/prod).

### 12.1 GCP 부트스트랩 현황 (cso-ai) — 2026-07-15 완료

| 항목 | 값/상태 |
|---|---|
| 프로젝트 | `cso-ai` (번호 538425656943) |
| 조직 | `nadoomodoo.com` (admin@nadoomodoo.com = owner) |
| 리전 | `asia-northeast3` (서울) |
| 결제 | ✅ `deep-tech-billing` (013817-F07731-5CE45B) |
| API | ✅ run · sqladmin · bigquery · cloudtasks · secretmanager · aiplatform · artifactregistry · iam |
| SA | `deployer@`(권한 미부여 — 초기 ADC 사용), `vertex-ocr@`(roles/aiplatform.user) |
| Artifact Registry | ✅ `apps` (docker, asia-northeast3) |
| 조직정책 도메인제한 | ALLOW(전부) → 공개 Cloud Run 가능 |

- **deployer 권한 전략**: 초기 Pulumi는 **admin ADC**로 실행(owner 남발 회피). deployer SA 최소권한 부여는 **CI/CD 도입 시** 승인받아 진행(run.admin·cloudsql.admin·bigquery.admin·cloudtasks.admin·secretmanager.admin·artifactregistry.admin·storage.admin·iam.serviceAccountAdmin·serviceAccountUser·projectIamAdmin·serviceUsageAdmin).
- **웹 도메인**: `cso.nadoo.ai` — **Cloud Run 도메인 매핑(CNAME 방식 확정)**. portal 배포 후: ① GCP 도메인 소유 확인(nadoo.ai, Search Console) → ② `gcloud run domain-mappings create` → ③ DNS에 **CNAME `cso` → `ghs.googlehosted.com`** (고정 IP·LB 불필요, SSL 자동). OAuth 리디렉트 `https://cso.nadoo.ai/api/auth/callback/...`·승인 출처 등록.
- **OAuth**: Client ID `538425656943-...apps.googleusercontent.com` 생성됨(어드민 Google OpenID). Client Secret은 Secret Manager(`google-oauth-client-secret`)에 KMS로 저장.
- **콘솔 잔여(사용자)**: 동의화면(External); Vertex Gemini 3.x `global` 쿼터 확인(신규 프로젝트 쿼터 0 가능).
- **Pulumi 상태 백엔드**: GCS 셀프매니지드 버킷 `gs://cso-ai-pulumi-state` + KMS 시크릿 프로바이더(`keyRings/pulumi/cryptoKeys/state`).

**✅ 인프라 프로비저닝 완료 (2026-07-15, `pulumi up` dev 스택):**

| 리소스 | 식별자 |
|---|---|
| Cloud SQL 커넥션 | `cso-ai:asia-northeast3:platform-db-e03cfff` (DB `platform`, 유저 `app`) |
| GCS 결과 버킷 | `cso-ai-results` (**30일 자동삭제**, 약관 고지 대상) |
| Cloud Tasks 큐 | `hira-detect-2bbbf47` |
| BigQuery | `platform.api_call_log` |
| 런타임 SA | `api-run@cso-ai...`, `portal-run@cso-ai...` (+ `vertex-ocr@` processor용) |
| Secret(값 주입됨) | `database-url`, `auth-secret`(랜덤), `google-oauth-client-secret`, `teams-webhook-url` |
| Secret(빈 상태) | `vertex-credentials` — Cloud Run에 `vertex-ocr@` SA 직접 연결 시 불필요(로컬/키방식일 때만 채움) |

- config `googleOAuthClientId`=`538425656943-...`, `webDomain`=`cso.nadoo.ai`. 시크릿값은 `Pulumi.dev.yaml`에 KMS 암호화 저장(커밋 안전).

### 12.2 로컬 개발 환경

배포된 GCP 인프라와 **독립 실행**. 클라우드 의존 최소화, 에뮬레이터 없는 것만 실제 API.

| 요소 | 로컬 방식 |
|---|---|
| DB | docker Postgres → `postgresql://app:app@localhost:5432/platform` + `prisma migrate dev` (Cloud SQL 안 건드림) |
| 세션 | `.env.local`의 `AUTH_SECRET`(로컬 랜덤) |
| 어드민 Google | 동일 OAuth 클라이언트에 localhost 리디렉트 추가 |
| 시크릿 | Secret Manager 대신 `.env.local`(gitignore) |
| Vertex(OCR) | 에뮬레이터 없음 → 실제 API(ADC 또는 SA JSON) |
| GCS(결과) | dev 버킷 또는 `fake-gcs-server` 또는 `STORAGE_MODE=local`(로컬 파일) |
| Cloud Tasks(벌크) | 로컬 에뮬레이터 없음 → `QUEUE_MODE=inline`(동기 처리) |
| BigQuery | dev 데이터셋 실제 사용 또는 콘솔/파일 대체 |
| 도메인 | `http://localhost:3000` |

**OAuth localhost 등록(필수)**: 리디렉트 `http://localhost:3000/api/auth/callback/google`, JS 출처 `http://localhost:3000` (cso.nadoo.ai와 병행 등록).

**`.env.local` 예시**:
```
DATABASE_URL=postgresql://app:app@localhost:5432/platform
AUTH_SECRET=<로컬 랜덤>
AUTH_GOOGLE_ID=538425656943-...apps.googleusercontent.com
AUTH_GOOGLE_SECRET=GOCSPX-...
ADMIN_HD=nadoomodoo.com
TEAMS_WEBHOOK_URL=<웹훅>
VERTEX_PROJECT_ID=cso-ai
VERTEX_LOCATION=global
MODEL_NAME=gemini-3.1-flash-lite
QUEUE_MODE=inline
STORAGE_MODE=local
```

배포와의 차이는 **환경변수 + QUEUE_MODE/STORAGE_MODE 플래그**뿐 — 코드는 동일. docker-compose(Postgres) + `.env.example` + 모드 플래그는 M0~M1에서 구성.
- **CI/CD**: turbo build → 서비스별 컨테이너 빌드 → Cloud Run deploy(이미지 태그). Prisma migrate + `pulumi up`은 배포 파이프라인 단계.

---

## 13. 출처표시(라이선스 의무) 구현 지점
- Portal 푸터 + 제품 문서: `출처: 건강보험심사평가원, 공공누리 제1유형`.
- (선택) 추출 API 응답 메타에 `attribution` 필드.
- 제약사명은 제품 식별용으로만 표기(브랜드화 금지).

---

## 14. 보안
- **`vertex.txt`/`.env` 자격증명 로테이션 + git 히스토리 제거**(`git filter-repo`), 이후 Secret Manager만 사용.
- API 키: 원문 미저장(SHA-256 해시), 발급 시 1회 노출, prefix만 표시.
- 어드민 이중 게이트(hd + role), 비인가 `/admin`은 404.
- GCS 결과는 짧은 TTL 서명 URL. 처방전 이미지 **무저장**(처리 후 폐기).
- 최소권한 SA(§12).

---

## 15. 테스트 전략
- **단위**: 과금 엔진(무료→유료 전이, 잔액경계, idempotent 재요청, 환불), 코마케팅 해석, OCR 파싱(기존).
- **동시성**(핵심): 같은 유저에 병렬 N요청 → 총 차감 = 성공수×price, 중복과금 0, 잔액 음수 0. `requestId` 재사용 시 1회만 과금.
- **통합**: 키발급→호출→과금→BigQuery 로그→정산 합계 일치.
- **부하**: 벌크 대량 enqueue 시 Cloud Tasks dispatch rate가 Vertex 상한 준수, FAILED 재시도 동작.
- **인증**: 비-nadoomodoo 계정 `/admin` 차단, 만료/폐기 키 거부.
- **UI**: design.md 수용 체크리스트(데스크톱/모바일 스크린샷, 빈/에러 상태).

---

## 16. 남은 미세 결정
- job 상태 저장소: Postgres 경량 테이블 vs Firestore (폴링 빈도·비용 trade-off).
- 큐: 단일 vs 프로덕트별 (초기 단일, 프로덕트 증가 시 분리).
- BigQuery 인제스트: 배치 로드(무료) vs 스트리밍(실시간). 초기 배치.
- Portal/Admin 분리 배포 여부(초기 단일 앱 `/admin` 라우트).

---

## 17. 마일스톤 & 수용 기준

| M | 범위 | 수용 기준 |
|---|---|---|
| **M0 포팅** | processor-hira Cloud Run, GCS I/O, 마스터+fallback | 샘플 이미지 태깅 결과가 기존 Lambda와 동일, 서명 URL 반환 |
| **M1 컨트롤 플레인** | 스키마·마이그레이션, 키 발급/검증, 과금 엔진, 프록시 | 유료 호출 1건이 정확히 200원 차감 + 무료 10회 동작 + 동시성 테스트 통과 |
| **M2 이력/정산** | BigQuery 로깅·조회, 정산 쿼리 | 호출 수와 로그 수 일치, 월 매출 = Σ(cost_krw) |
| **M3 벌크** | Cloud Tasks, job 폴링 | 대량 벌크 안정 처리, 부분성공 정확 과금, dispatch rate 준수 |
| **M4 신청·어드민** | Teams 웹훅, 어드민(프로덕트/충전/유저/신청/코마케팅) | design.md 수용 체크리스트 통과, 수동충전→잔액 반영, CSV 임포트 |
| **M5 랜딩·고객** | 카탈로그·대시보드(키·이력·충전·신청) | 신규 유저 가입→키 발급→무료 호출→402→신청 전 과정 동작 |
| **M6 하드닝** | 보안(시크릿 로테이션·SA), 부하·장애 테스트, 출처표시 | §14 완료, 부하 테스트 SLO, 라이선스 표기 노출 |
