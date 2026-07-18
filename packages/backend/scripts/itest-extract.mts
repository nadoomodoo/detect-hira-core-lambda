/**
 * 로컬 통합 테스트 — 크롭 사이드카(실기동) → Gemini 추출 → 검증 → 영속화 → DB 확인.
 *   CROP_SERVICE_URL=http://127.0.0.1:8099 \
 *     npx tsx --env-file=../../.env scripts/itest-extract.mts [이미지]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "@platform/db";
import { extractEdi } from "../src/extract.js";
import { persistExtraction } from "../src/persist.js";

const CROP_DIR = "/Users/hamelmoon/workspaces/edi-img-crop-rt-detr/edi-data";
const file = process.argv[2] ?? join(CROP_DIR, readdirSync(CROP_DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort()[0]);

console.log("CROP_SERVICE_URL:", process.env.CROP_SERVICE_URL ?? "(미설정)");
console.log("이미지:", file);

const product = await prisma.product.findUnique({ where: { slug: "hira-extract" } });
if (!product) { console.error("hira-extract Product 없음 — seed:extract 먼저 실행"); process.exit(1); }

const raw = readFileSync(file);
const fmt = (await sharp(raw).metadata()).format;
const mime = fmt === "jpeg" ? "image/jpeg" : "image/png";

const t0 = Date.now();
const r = await extractEdi(raw, mime, { recrop: true });
console.log(`\n[추출] 표검출=${r.foundTable} 행=${r.rows.length} 합계행=${r.summaryRowCount} ${Date.now() - t0}ms`);
console.log(`[크롭] fallback=${r.cropMeta.fallback} bbox=${JSON.stringify(r.cropMeta.bbox ?? null)} score=${(r.cropMeta as any).score ?? "-"} rot=${(r.cropMeta as any).applied_rotation ?? "-"}`);
console.log(`[신호등] ${JSON.stringify(r.tallies)}  [단계원가] ${r.costs.map((c) => `${c.stage}=${c.costKrw.toFixed(2)}원`).join(", ")}`);

const requestId = `itest-${randomUUID()}`;
const exId = await persistExtraction(r, { requestId, userId: "local-test-user", productId: product.id });
console.log(`\n[영속화] EdiExtraction id=${exId}`);

const ex = await prisma.ediExtraction.findUnique({ where: { id: exId }, include: { rows: true } });
const costs = await prisma.usageCost.findMany({ where: { requestId } });
console.log(`[DB확인] EdiExtractionRow=${ex?.rows.length}건, UsageCost=${costs.length}건 (${costs.map((c) => c.stage).join("/")})`);
console.log(`[DB확인] 템플릿 스냅샷: key=${ex?.templateKey} v${ex?.templateVersion} id=${ex?.templateId}`);
console.log(`[DB확인] needsReview 행=${ex?.rows.filter((x) => x.needsReview).length}, codeType=${[...new Set(ex?.rows.map((x) => x.codeType))].join(",")}`);

// 정리
await prisma.usageCost.deleteMany({ where: { requestId } });
await prisma.ediExtraction.delete({ where: { id: exId } });
console.log("\n[정리] 테스트 레코드 삭제 완료");
await prisma.$disconnect();
process.exit(0);
