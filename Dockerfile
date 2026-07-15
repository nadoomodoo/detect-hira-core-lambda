# processor-hira — Cloud Run 컨테이너 (Node 22 + sharp + Prisma)
# 빌드: gcloud builds submit → asia-northeast3-docker.pkg.dev/cso-ai/apps/processor-hira
# 마스터는 Cloud SQL DrugMaster 조회 (DATABASE_URL) — 파일 번들 불필요.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# 한글 폰트 — 멀티 제약사 태깅 시 라벨(제약사명) 렌더링에 필요
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
# 빌드 산출물 + 생성된 Prisma 클라이언트(엔진 포함) 복사
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
