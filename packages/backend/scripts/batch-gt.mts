/**
 * edi-data 전체를 파이프라인으로 OCR → GT(정답) 초안 생성. 수기 보정용.
 *   CROP_SERVICE_URL=http://127.0.0.1:8099 \
 *     npx tsx --env-file=../../.env scripts/batch-gt.mts [입력디렉토리] [출력디렉토리]
 *   기본: <repo>/edi-data → <repo>/output/gt  (gt_draft.csv + gt_draft.json)
 *
 * 산출: 이미지×약품행 단위 CSV(Excel, BOM). 각 값 셀을 직접 고쳐 GT를 완성한다.
 * 마스터·산술은 검증 신호일 뿐, 셀 값은 이미지에서 읽은 OCR 값(정본)이다.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { extractEdi } from "../src/extract.js";

const REPO = "/Users/hamelmoon/workspaces/detect-hira-code";
const inDir = process.argv[2] ?? join(REPO, "edi-data");
const outDir = process.argv[3] ?? join(REPO, "output", "gt");
const concurrency = Number(process.env.GT_CONCURRENCY) || 4;
const limit = Number(process.env.GT_LIMIT) || 0;
mkdirSync(outDir, { recursive: true });

function csv(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

let files = readdirSync(inDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
if (limit > 0) files = files.slice(0, limit);
console.log(`GT 생성: ${files.length}장 (${inDir} → ${outDir}, 동시 ${concurrency}, 크롭 ${process.env.CROP_SERVICE_URL ? "ON" : "OFF"})\n`);

interface OutRow {
  file: string;
  foundTable: boolean;
  documentType: string;
  rotation: number | "";
  columns: string;
  rowIndex: number | "";
  drugCode: string;
  drugName: string;
  manufacturer: string;
  quantity: number | "";
  days: number | "";
  prescribedQty: number | "";
  unitPrice: number | "";
  totalAmount: number | "";
  priceStatus: string;
  masterUnitPrice: number | "";
  trafficLight: string;
  needsReview: string;
  flags: string;
  error?: string;
}

let done = 0;
const perFile = await mapLimit(files, concurrency, async (f) => {
  const rows: OutRow[] = [];
  const jsonRec: any = { file: f };
  try {
    const raw = readFileSync(join(inDir, f));
    const fmt = (await sharp(raw).metadata()).format;
    const mime = fmt === "jpeg" ? "image/jpeg" : "image/png";
    const r = await extractEdi(raw, mime, { recrop: true });
    jsonRec.foundTable = r.foundTable;
    jsonRec.documentType = r.documentType;
    jsonRec.appliedRotation = r.appliedRotation;
    jsonRec.fullImageRetry = r.fullImageRetry;
    jsonRec.columns = r.columns;
    jsonRec.cropFallback = r.cropMeta.fallback;
    jsonRec.rows = r.rows.map((x) => ({
      rowIndex: x.rowIndex, drugCode: x.drugCode, drugName: x.drugName, manufacturer: x.manufacturer,
      quantity: x.quantity, days: x.days, prescribedQty: x.prescribedQty, unitPrice: x.unitPrice, totalAmount: x.totalAmount,
      priceStatus: (x as any).priceStatus, masterUnitPrice: (x as any).masterUnitPrice,
      trafficLight: x.trafficLight, needsReview: x.needsReview, reviewFlags: x.reviewFlags,
    }));
    const cols = r.columns.join(" | ");
    if (r.rows.length === 0) {
      rows.push(emptyRow(f, r.foundTable, cols, r.documentType, r.appliedRotation));
    } else {
      for (const x of r.rows) {
        rows.push({
          file: f, foundTable: r.foundTable, documentType: r.documentType, rotation: r.appliedRotation, columns: cols, rowIndex: x.rowIndex,
          drugCode: x.drugCode ?? "", drugName: x.drugName ?? "", manufacturer: x.manufacturer ?? "",
          quantity: x.quantity ?? "", days: x.days ?? "", prescribedQty: x.prescribedQty ?? "",
          unitPrice: x.unitPrice ?? "", totalAmount: x.totalAmount ?? "",
          priceStatus: (x as any).priceStatus ?? "", masterUnitPrice: (x as any).masterUnitPrice ?? "",
          trafficLight: x.trafficLight, needsReview: x.needsReview ? "Y" : "", flags: (x.reviewFlags ?? []).join("; "),
        });
      }
    }
  } catch (e) {
    jsonRec.error = e instanceof Error ? e.message : String(e);
    const er = emptyRow(f, false, "", "unknown", "");
    er.error = jsonRec.error;
    rows.push(er);
  }
  done++;
  if (done % 5 === 0 || done === files.length) console.log(`  ${done}/${files.length}`);
  return { rows, jsonRec };
});

function emptyRow(file: string, foundTable: boolean, columns: string, documentType: string, rotation: number | ""): OutRow {
  return { file, foundTable, documentType, rotation, columns, rowIndex: "", drugCode: "", drugName: "", manufacturer: "", quantity: "", days: "", prescribedQty: "", unitPrice: "", totalAmount: "", priceStatus: "", masterUnitPrice: "", trafficLight: "", needsReview: "", flags: "" };
}

// CSV
const header = ["file", "foundTable", "documentType", "rotation", "columns", "rowIndex", "drugCode", "drugName", "manufacturer", "quantity", "days", "prescribedQty", "unitPrice", "totalAmount", "priceStatus", "masterUnitPrice", "trafficLight", "needsReview", "flags", "error"];
const lines = [header.join(",")];
for (const pf of perFile) for (const r of pf.rows) {
  lines.push([r.file, r.foundTable, r.documentType, r.rotation, r.columns, r.rowIndex, r.drugCode, r.drugName, r.manufacturer, r.quantity, r.days, r.prescribedQty, r.unitPrice, r.totalAmount, r.priceStatus, r.masterUnitPrice, r.trafficLight, r.needsReview, r.flags, r.error ?? ""].map(csv).join(","));
}
const csvPath = join(outDir, "gt_draft.csv");
writeFileSync(csvPath, "﻿" + lines.join("\n"), "utf8"); // BOM for Excel

const jsonPath = join(outDir, "gt_draft.json");
writeFileSync(jsonPath, JSON.stringify(perFile.map((p) => p.jsonRec), null, 2), "utf8");

// 요약
const allRows = perFile.flatMap((p) => p.rows);
const tables = perFile.filter((p) => p.jsonRec.foundTable).length;
const errs = perFile.filter((p) => p.jsonRec.error).length;
console.log(`\n완료: 이미지 ${files.length}장(표검출 ${tables}, 오류 ${errs}) · 약품행 ${allRows.filter((r) => r.rowIndex !== "").length}행`);
console.log(`CSV: ${csvPath}`);
console.log(`JSON: ${jsonPath}`);
process.exit(0);
