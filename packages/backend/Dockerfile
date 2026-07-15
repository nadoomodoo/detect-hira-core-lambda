# processor/gateway — Cloud Run (Node 22 + sharp + Prisma), pnpm 워크스페이스
#
# ⚠️ 빌드 컨텍스트 = 리포 루트 (워크스페이스 전체 필요).
#   배포: gcloud builds submit --config=cloudbuild.yaml  (또는)
#         docker build -f packages/backend/Dockerfile -t <img> .
# 마스터는 Cloud SQL DrugMaster 조회 — 파일 번들 불필요.

FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @platform/db build && pnpm --filter @platform/backend build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
# 한글 폰트(태깅 라벨 렌더링) + OpenSSL(Prisma 쿼리엔진 debian-openssl-3.0.x)
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# pnpm 심링크 node_modules 보존을 위해 워크스페이스 전체 복사
COPY --from=build /repo /repo
WORKDIR /repo/packages/backend
EXPOSE 8080
# server=processor, gateway=게이트웨이 (Cloud Run --command 로 선택)
CMD ["node", "dist/server.js"]
