/**
 * extract 엔드투엔드 스모크 — 실제 Gemini 호출로 1장 추출(크롭 사이드카/영속화 없이).
 *   npx tsx --env-file=../../.env scripts/smoke-extract.mts [이미지경로]
 * 기본 이미지: edi-img-crop-rt-detr/edi-data 의 첫 jpg.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { extractEdi } from "../src/extract.js";

const CROP_DIR = "/Users/hamelmoon/workspaces/edi-img-crop-rt-detr/edi-data";
const arg = process.argv[2];
const file = arg ?? join(CROP_DIR, readdirSync(CROP_DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort()[0]);

console.log("이미지:", file);
const raw = readFileSync(file);
const fmt = (await sharp(raw).metadata()).format;
const mime = fmt === "jpeg" ? "image/jpeg" : "image/png";

const t0 = Date.now();
const r = await extractEdi(raw, mime, { recrop: false });
console.log(`\n표검출: ${r.foundTable} · 행 ${r.rows.length} · ${Date.now() - t0}ms`);
console.log("컬럼:", r.columns.join(" | "));
console.log("신호등:", JSON.stringify(r.tallies));
console.log("원가:", r.costs.map((c) => `${c.stage}:${c.tokensIn}/${c.tokensOut}tok ${c.costKrw.toFixed(2)}원`).join(", "));
console.log("\n행:");
for (const row of r.rows.slice(0, 20)) {
  console.log(
    `  [${row.rowIndex}] ${row.trafficLight} code=${row.drugCode ?? "-"}(${row.codeType}) ` +
      `수량=${row.quantity ?? "-"} 일수=${row.days ?? "-"} 총처방=${row.prescribedQty ?? "-"} ` +
      `단가=${row.unitPrice ?? "-"} 총금액=${row.totalAmount ?? "-"}` +
      (row.needsReview ? ` ⚠︎(${row.reviewFlags.join(";")})` : ""),
  );
}
process.exit(0);
