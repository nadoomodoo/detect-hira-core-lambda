# 나두AI 포털 — Cloud Run (Next.js standalone, pnpm 워크스페이스)
# ⚠️ 빌드 컨텍스트 = 리포 루트. cloudbuild-portal.yaml 로 빌드.

FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @platform/db build
RUN pnpm --filter @platform/portal build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Prisma 쿼리엔진용 OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Next standalone 출력 (outputFileTracingRoot=repo root → repo 구조 보존)
COPY --from=build /repo/packages/portal/.next/standalone ./
COPY --from=build /repo/packages/portal/.next/static ./packages/portal/.next/static
# 정적 자산(public/) — standalone 은 public 을 포함하지 않으므로 명시 복사
COPY --from=build /repo/packages/portal/public ./packages/portal/public
# Prisma 쿼리 엔진 — Next standalone 트레이싱이 누락하므로 명시 복사 (.pnpm 경로 보존)
COPY --from=build /repo/node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_typescript@5.9.3__typescript@5.9.3/node_modules/.prisma ./node_modules/.pnpm/@prisma+client@6.19.3_prisma@6.19.3_typescript@5.9.3__typescript@5.9.3/node_modules/.prisma
EXPOSE 3000
CMD ["node", "packages/portal/server.js"]
