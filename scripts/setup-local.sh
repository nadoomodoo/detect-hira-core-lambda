#!/usr/bin/env bash
# 로컬 최초 셋업 한방: DB → 스키마 → 약가마스터(59k) → 프로덕트/API키 → 데모계정.
# 재실행 안전(약가마스터 createMany skipDuplicates, 시드 upsert). 사용: pnpm setup:local
set -euo pipefail
cd "$(dirname "$0")/.."
LOCAL_DB="postgresql://app:devpassword@127.0.0.1:5433/platform"

echo "▶ DB(compose) 기동…"
docker compose up -d postgres >/dev/null
for i in $(seq 1 30); do nc -z 127.0.0.1 5433 2>/dev/null && break; sleep 1; done

# ⚠️ 안전장치: db push 는 스키마를 파괴적으로 맞추므로(컬럼 삭제 등) 반드시 로컬 DB 에만.
#    LOCAL_DB 호스트가 127.0.0.1/localhost 가 아니면 즉시 중단(프로드 오염·데이터 유실 방지).
DB_HOST=$(printf '%s' "$LOCAL_DB" | sed -E 's#^[^@]+@([^:/]+).*#\1#')
if [ "$DB_HOST" != "127.0.0.1" ] && [ "$DB_HOST" != "localhost" ]; then
  echo "✖ 중단: db push 대상이 로컬이 아닙니다(host=$DB_HOST). setup:local 은 로컬 전용입니다."
  echo "  원격/프로드 스키마 변경은 마이그레이션(prisma migrate deploy · db-migrate Job)만 쓰세요. (AGENTS.md 참고)"
  exit 1
fi

echo "▶ 스키마 push (로컬 전용)…"
DATABASE_URL="$LOCAL_DB" pnpm --filter @platform/db build >/dev/null 2>&1 || true
DATABASE_URL="$LOCAL_DB" pnpm --filter @platform/db exec prisma db push --skip-generate

# DRUG_MASTER_PATH: env > 루트 .env
DMP="${DRUG_MASTER_PATH:-}"
if [ -z "$DMP" ] && [ -f .env ]; then DMP=$(grep -E '^DRUG_MASTER_PATH=' .env | cut -d= -f2- || true); fi

cd packages/backend
if [ -n "$DMP" ] && [ -f "$DMP" ]; then
  echo "▶ 약가마스터 시드 (59k)…"
  DATABASE_URL="$LOCAL_DB" DRUG_MASTER_PATH="$DMP" ./node_modules/.bin/tsx scripts/seed-drugmaster.mts
else
  echo "⚠ DRUG_MASTER_PATH 미설정/파일없음 → 약가마스터 시드 생략(검출 시 제약사 미조회 가능)."
  echo "   설정: DRUG_MASTER_PATH=/path/drug_master_merged.csv pnpm setup:local"
fi

echo "▶ 프로덕트 + API키 시드(processorUrl=localhost:8080)…"
KEY=$(DATABASE_URL="$LOCAL_DB" TEST_PROCESSOR_URL="http://localhost:8080" ./node_modules/.bin/tsx scripts/seed-gateway-test.mts | grep '^KEY=' | cut -d= -f2)
echo "▶ 데모 고객 시드…"
DATABASE_URL="$LOCAL_DB" ./node_modules/.bin/tsx scripts/seed-demo.mts
cd ../..

# 포털 .env.local 의 DEMO_API_KEY 를 방금 발급한 로컬 키로 갱신(데모/회귀용)
if [ -n "${KEY:-}" ] && [ -f packages/portal/.env.local ]; then
  perl -pi -e "s#^DEMO_API_KEY=.*#DEMO_API_KEY=$KEY#" packages/portal/.env.local
  echo "  포털 .env.local DEMO_API_KEY 갱신"
fi

echo ""
echo "✔ 셋업 완료 — 이제: pnpm dev"
echo "   로컬 API 키: ${KEY:-(발급 실패)}"
echo "   데모 로그인: demo@nadoomodoo.com / demo12345678"
