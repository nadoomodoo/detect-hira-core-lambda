# processor-hira — Cloud Run 컨테이너 (Node 22 + sharp)
# 빌드: gcloud builds submit / docker build → asia-northeast3-docker.pkg.dev/cso-ai/apps/processor-hira

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# 약가 마스터 데이터 — 배포 시 제공 (택1):
#  (a) 이미지 번들:  COPY data/drug_master.csv /app/data/drug_master.csv
#                     ENV DRUG_MASTER_PATH=/app/data/drug_master.csv
#  (b) GCS 로드: cold start 시 GCS 에서 다운로드 (M0 후속)
# 현재는 DRUG_MASTER_PATH 환경변수로 경로를 주입한다.

EXPOSE 8080
CMD ["node", "dist/server.js"]
