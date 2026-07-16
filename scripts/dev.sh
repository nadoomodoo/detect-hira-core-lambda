#!/usr/bin/env bash
# 로컬 풀스택 한방 기동. 사용: pnpm dev  (또는 UI만: pnpm dev:ui)
#   - DB(compose 5433) → 스키마 동기(idempotent) → 프로세서·게이트웨이·포털
#   - Ctrl-C 시 자식 프로세스 일괄 종료
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-full}"   # full | ui
LOCAL_DB="postgresql://app:devpassword@127.0.0.1:5433/platform"

echo "▶ 로컬 DB(compose) 기동…"
docker compose up -d postgres >/dev/null
for i in $(seq 1 30); do nc -z 127.0.0.1 5433 2>/dev/null && break; sleep 1; done
echo "▶ 스키마 동기(db push)…"
DATABASE_URL="$LOCAL_DB" pnpm --filter @platform/db exec prisma db push --skip-generate >/dev/null 2>&1 || true

pids=()
cleanup() { echo; echo "▶ 종료 중…"; for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

if [ "$MODE" != "ui" ]; then
  echo "▶ 프로세서  :8080"
  pnpm --filter @platform/backend serve:dev & pids+=($!)
  echo "▶ 게이트웨이 :8090"
  pnpm --filter @platform/backend gateway:dev & pids+=($!)
fi
echo "▶ 포털      :3000"
pnpm --filter @platform/portal dev & pids+=($!)

echo "──────────────────────────────────────"
echo " 포털      http://localhost:3000"
[ "$MODE" != "ui" ] && echo " 게이트웨이 http://localhost:8090  ·  프로세서 :8080"
echo " (종료: Ctrl-C)"
echo "──────────────────────────────────────"
wait
