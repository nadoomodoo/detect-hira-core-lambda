-- API 종류(SSOT) — 엔드포인트/문서/데모/응답형태 결정. 기존 slug 하드코딩 제거.
CREATE TYPE "ApiKind" AS ENUM ('DETECT', 'EXTRACT');

ALTER TABLE "Product" ADD COLUMN "apiKind" "ApiKind" NOT NULL DEFAULT 'DETECT';

-- 기존 추출 계열 슬러그를 EXTRACT 로 승격(하위호환: 나머지는 DETECT 기본값 유지).
UPDATE "Product" SET "apiKind" = 'EXTRACT' WHERE "slug" = 'hira-extract';
