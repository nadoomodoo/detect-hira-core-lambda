# Agent Instructions

## Project Overview
**나두AI API 마켓플레이스** (repo: `detect-hira-code`) — GCP 기반 제약 CSO 업무용 REST API 마켓플레이스.
첫 API는 **멀티 제약사 라벨링**(`hira-detect`): 처방전·EDI 이미지에서 약가코드를 검출해 제약사를 식별하고 원본·라벨 이미지 + 좌표(JSON)를 반환.

## Architecture
- **Monorepo**: pnpm workspaces — `packages/{db,backend,portal}`
- **DB 패키지**: `@platform/db` (Prisma 6 + PostgreSQL) — 스키마·마이그레이션·공유 클라이언트의 단일 출처
- **Backend**: gateway(`asia-northeast1`) + processor-hira(`asia-northeast3`) — 단일 이미지 `processor-hira`, 커맨드로 역할 분기
- **Portal**: Next.js 15 App Router + NextAuth v5 (`asia-northeast1`)
- **Infra**: Cloud Run, Cloud SQL(Postgres, `platform-db-e03cfff` @ an3), Vertex AI Gemini(@google/genai), GCS, BigQuery, Cloud Tasks, Secret Manager
- **로컬**: docker-compose Postgres(port **5433**, app/devpassword). `pnpm setup:local` → `pnpm dev`

## ⚠️ Prisma Migration Rules (CRITICAL)

스키마 변경은 **반드시 CLI로 마이그레이션 파일을 생성**한다. 손으로 만들거나 `db push`로 때우면 프로드 이력이 꼬인다.
(실제 사례: 2026-07-16 이메일 인증·Job 스키마를 마이그레이션 없이 `db push`로만 반영 → 프로드 이력 누락 → 07-17 캐치업 마이그레이션을 수동 작성해야 했음)

**절대 금지:**
1. `packages/db/prisma/migrations/` 에 파일 **직접 생성/수정/삭제 금지** — CLI 산출물만 커밋(생성 후 확인만)
2. **`schema.prisma`만 수정하고 마이그레이션 없이 커밋 금지** — 스키마 변경과 마이그레이션 파일은 **같은 커밋**에 포함
3. **스키마 "변경"에 `prisma db push` 금지** — 이력을 안 남겨 프로드가 꼬인다. 스키마를 바꿀 땐 반드시 `migrate`로 파일을 만든다. (로컬 최초 부트스트랩 `pnpm setup:local`이 내부적으로 쓰는 db push는 빈 DB 세팅용이라 예외 — 단, 스키마를 바꿨다면 부트스트랩이 아니라 마이그레이션 경로로)
4. **`prisma migrate dev`를 `--create-only` 없이 실행 금지** — DB가 리셋되어 로컬 시딩 데이터가 유실됨
5. **프로드에 `migrate dev`/`migrate reset` 절대 금지** — 프로드는 오직 `migrate deploy`(적용)만

**반드시 CLI만 사용** (`packages/db`에서):
```bash
cd packages/db

# 1) schema.prisma 수정 후 — 마이그레이션 파일만 생성 (DB 리셋 없음)
pnpm exec prisma migrate dev --name descriptive_name --create-only
# 로컬 DB 에 드리프트가 있어 shadow 가 필요하면 diff 로 생성:
#   pnpm exec prisma migrate diff --from-migrations prisma/migrations \
#     --to-schema-datamodel prisma/schema.prisma \
#     --shadow-database-url postgresql://app:devpassword@127.0.0.1:5433/shadow_mig --script

# 2) 로컬 적용 + 클라이언트 재생성
pnpm exec prisma migrate deploy      # 로컬 dev DB(docker 5433)
pnpm exec prisma generate

# 3) 상태 확인 / 4) schema+migration 함께 커밋
pnpm exec prisma migrate status
```

**Workflow:** ① schema 수정 → ② `migrate dev --name <name> --create-only` → ③ `migrate deploy`(로컬) → ④ `generate` → ⑤ 생성 파일 **확인만**(수정 금지) → ⑥ schema+migration 같은 커밋으로 push.

**프로드 적용은 앱 이미지가 아니라 전용 경로로:**
- 프로드 마이그레이션은 **Cloud Run Job `db-migrate`**(이미지 `db-migrate`, `packages/db/Dockerfile.migrate`)로 `prisma migrate deploy` 실행. `database-url` 시크릿을 직접 마운트하므로 **로컬에 DB 크레덴셜을 꺼내지 않는다.**
  ```bash
  gcloud run jobs execute db-migrate --project cso-ai --region asia-northeast3 --wait
  ```
- 앱 컨테이너 기동 시점엔 마이그레이션을 돌리지 않는다(콜드스타트마다 실행/레이스 방지). 배포 파이프라인에서 **deploy 전에** Job을 돌린다.
- **additive가 아닌 변경**(컬럼/테이블 삭제·타입 변경)은 기존 리비전과의 호환을 깨므로, 배포 순서(마이그레이션↔코드)를 반드시 검토한다.

## 보안 (CRITICAL)
- **소스맵 노출 금지**: `productionBrowserSourceMaps: false` 유지
- **관리자 진입점 링크 미노출**: `/admin`은 주소 직접 입력으로만 접근. UI에 링크 만들지 말 것
- **시크릿은 Secret Manager**: `DATABASE_URL`·`RESEND_API_KEY`·`INTERNAL_API_SECRET` 등은 코드/깃/평문 env 금지, `secretKeyRef` 주입만
- **크레덴셜을 로컬로 꺼내지 말 것**: 프로드 DB 작업은 위 `db-migrate` Job 처럼 시크릿을 마운트하는 방식으로

## 배포
자세한 순서는 [docs/DEPLOY-RUNBOOK.md](docs/DEPLOY-RUNBOOK.md). 요지: 시크릿 등록 → 이미지 빌드(`cloudbuild-*.yaml`) → **`db-migrate` Job 실행** → Cloud Run 배포(traffic=LATEST) → 검증. 배포는 `git tag release-*` 트리거로 자동화 예정.

## 개발 명령
```bash
pnpm setup:local     # 로컬 DB push + 시딩(약가마스터 등)
pnpm dev             # 전체 로컬 기동
pnpm -r typecheck    # 타입 체크
```
