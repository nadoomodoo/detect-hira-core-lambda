# 프로덕션 배포 런북 (조율 배포 1회)

미배포 변경분을 안전하게 한 번에 내보내는 순서. **순서 중요** — 특히 마이그레이션 직후 백필(기존 고객 로그인 잠금 방지).

## 미배포 변경분 (2026-07-16 기준)
- 백엔드: v10 → **v11** (비동기 벌크 M3 + `Job`/`JobItem` 스키마)
- 포털: v16 → **vN** (브랜딩 + 이메일 인증 + 벌크 문서)
- 스키마 신규: `User.emailVerified`, `EmailVerificationToken`, `Job`, `JobItem`
- 신규 시크릿: `RESEND_API_KEY`(이메일 발송)

## 사전 조건
- [ ] 포털 브랜딩 작업 커밋 완료 (globals.css·PublicHeader/Footer·logo.svg·docs/page.tsx)
- [ ] `pnpm -r typecheck` + `pnpm --filter @platform/portal build` 통과
- [ ] `RESEND_API_KEY` 발급 (resend.com) + 도메인 발신 인증(SPF/DKIM)

## 순서

### 1. 시크릿 등록
```bash
printf '<RESEND_API_KEY>' | gcloud secrets create resend-api-key --project cso-ai --data-file=- --replication-policy=automatic
# 포털 SA(portal-run)가 프로젝트레벨 secretAccessor 없으면 부여(승인 필요):
# gcloud secrets add-iam-policy-binding resend-api-key --member=serviceAccount:portal-run@cso-ai.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
```

### 2. 이미지 빌드
```bash
gcloud builds submit --config cloudbuild-backend.yaml --project cso-ai --service-account=projects/cso-ai/serviceAccounts/538425656943-compute@developer.gserviceaccount.com --default-buckets-behavior=regional-user-owned-bucket   # backend v11
gcloud builds submit --config cloudbuild-portal.yaml  --project cso-ai --service-account=projects/cso-ai/serviceAccounts/538425656943-compute@developer.gserviceaccount.com --default-buckets-behavior=regional-user-owned-bucket   # portal vN
```

### 3. 프로드 DB 마이그레이션 + 백필 (⚠️ 순서 엄수)
```bash
# 프로드 Cloud SQL 로 프록시 (유효 토큰)
/tmp/cloud-sql-proxy --token="$(gcloud auth print-access-token)" cso-ai:asia-northeast3:platform-db-e03cfff --port 5432 &

PROD="postgresql://app:<PW>@127.0.0.1:5432/platform"
# 3a. 스키마 반영 (emailVerified·EmailVerificationToken·Job·JobItem — 전부 additive)
DATABASE_URL="$PROD" pnpm --filter @platform/db exec prisma db push --skip-generate
# 3b. 즉시 백필 — 이걸 빼면 기존 고객이 로그인 차단됨!
cd packages/backend
DATABASE_URL="$PROD" ./node_modules/.bin/tsx scripts/backfill-email-verified.mts --dry   # 먼저 확인
DATABASE_URL="$PROD" ./node_modules/.bin/tsx scripts/backfill-email-verified.mts          # 실행
```

### 4. 배포 (traffic=LATEST 이므로 자동 전환)
```bash
gcloud run deploy processor-hira --project cso-ai --region asia-northeast3 --image asia-northeast3-docker.pkg.dev/cso-ai/apps/processor-hira:v11 --quiet
gcloud run deploy gateway        --project cso-ai --region asia-northeast1 --image asia-northeast3-docker.pkg.dev/cso-ai/apps/processor-hira:v11 --command node --args dist/gateway.js --quiet
gcloud run deploy portal --project cso-ai --region asia-northeast1 --image asia-northeast3-docker.pkg.dev/cso-ai/apps/portal:vN \
  --update-secrets RESEND_API_KEY=resend-api-key:latest \
  --update-env-vars APP_URL=https://market.nadoo.ai,MAIL_FROM='나두AI 마켓플레이스 <no-reply@market.nadoo.ai>' --quiet
```

### 5. 검증
- [ ] `market.nadoo.ai` 랜딩·브랜딩·문서(벌크 포함) 200
- [ ] 신규 가입 → 실제 인증메일 수신 → `/verify` → 로그인
- [ ] 기존 고객 로그인 정상(백필 확인)
- [ ] 데모/단건 검출 정상, `/detect-batch` 정상
- [ ] `/detect-batch-async` → 동기 폴백 결과 + `/api/v1/jobs/{id}` 폴링

## (선택) 진짜 비동기 활성화 — Cloud Tasks
동기 폴백으로도 동작하므로 선택. 활성화하려면:
1. 큐 확인: `hira-detect-2bbbf47`(infra 생성) 위치·이름 → `CLOUD_TASKS_QUEUE=projects/cso-ai/locations/<loc>/queues/<queue>`
2. IAM(승인 필요): 게이트웨이 SA(api-run)에 `roles/cloudtasks.enqueuer`; 워커 OIDC용 SA(`CLOUD_TASKS_SA`)가 게이트웨이 `run.invoker`
3. 게이트웨이 env: `CLOUD_TASKS_QUEUE`, `WORKER_URL=https://marketapi.nadoo.ai`, `CLOUD_TASKS_SA=<sa>`, `WORKER_SECRET=<랜덤>`(Secret 권장)

## 롤백
- Cloud Run: `gcloud run services update-traffic <svc> --to-revisions <직전>=100`
  - 현재 안정: backend v10, portal v16
- 스키마는 additive(컬럼/테이블 추가)라 구 리비전과 호환 — 롤백 시 DB 되돌릴 필요 없음.
