#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { extractEdi } from "./extract.js";
import { computeCost } from "./pricing.js";

/**
 * 모델 벤치마크 하네스 (§9) — 바인딩 Gemini 모델별 정확도·지연·원가를 edi-data 로 비교.
 *
 * 사용법:
 *   BENCH_MODELS="gemini-2.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash" \
 *     npx tsx src/bench.ts [<입력디렉토리>] [<출력디렉토리>]
 *   (기본: edi-data → output/bench)
 *
 * ground-truth CSV 가 없으면 프록시 지표(신호등 GREEN 비율·산술 일관성·행수)로 비교.
 * 정밀 측정은 소량 수동 라벨셋을 추가해 확장(향후).
 *
 * 결과: 모델별 요약 JSON + 파일×모델 상세 CSV. 원가는 pricing.ts 단가표 기준.
 */

const inDir = process.argv[2] ?? "edi-data";
const outDir = process.argv[3] ?? "output/bench";
const models = (process.env.BENCH_MODELS ?? "gemini-2.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash")
  .split(",").map((s) => s.trim()).filter(Boolean);
const concurrency = Number(process.env.BENCH_CONCURRENCY) || 4;
const limit = Number(process.env.BENCH_LIMIT) || 0; // 0 = 전체
const templateId = process.env.BENCH_TEMPLATE_ID || undefined;
const benchRun = process.env.BENCH_RUN || `bench-${models.join("_")}`;

mkdirSync(outDir, { recursive: true });

function csv(v: string | number | boolean | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

let files = readdirSync(inDir).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort();
if (limit > 0) files = files.slice(0, limit);
console.log(`벤치: 파일 ${files.length}개 × 모델 ${models.length}개 (${models.join(", ")})\n`);

interface Detail {
  file: string;
  model: string;
  foundTable: boolean;
  rows: number;
  green: number;
  yellow: number;
  red: number;
  needsReview: number;
  mathCheckedPass: number; // mathValid=true 행수
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  costKrw: number;
  latencyMs: number;
  error?: string;
}

const details: Detail[] = [];

for (const model of models) {
  console.log(`── 모델: ${model} ──`);
  const rows = await mapLimit(files, concurrency, async (f): Promise<Detail> => {
    const base: Detail = { file: f, model, foundTable: false, rows: 0, green: 0, yellow: 0, red: 0, needsReview: 0, mathCheckedPass: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, costKrw: 0, latencyMs: 0 };
    try {
      const raw = readFileSync(join(inDir, f));
      const fmt = (await sharp(raw).metadata()).format;
      const mime = fmt === "jpeg" ? "image/jpeg" : "image/png";
      const r = await extractEdi(raw, mime, { templateId, modelOverride: model, recrop: false });
      const tokensIn = r.costs.reduce((s, c) => s + c.tokensIn, 0);
      const tokensOut = r.costs.reduce((s, c) => s + c.tokensOut, 0);
      const { costUsd, costKrw } = computeCost(model, tokensIn, tokensOut);
      return {
        ...base,
        foundTable: r.foundTable,
        rows: r.rows.length,
        green: r.tallies.green,
        yellow: r.tallies.yellow,
        red: r.tallies.red,
        needsReview: r.rows.filter((x) => x.needsReview).length,
        mathCheckedPass: r.rows.filter((x) => x.mathValid).length,
        tokensIn, tokensOut, costUsd, costKrw,
        latencyMs: r.costs.reduce((s, c) => s + c.latencyMs, 0),
      };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : String(e) };
    }
  });
  details.push(...rows);
  const ok = rows.filter((r) => !r.error);
  const totRows = ok.reduce((s, r) => s + r.rows, 0);
  const green = ok.reduce((s, r) => s + r.green, 0);
  const cost = ok.reduce((s, r) => s + r.costKrw, 0);
  const lat = ok.length ? Math.round(ok.reduce((s, r) => s + r.latencyMs, 0) / ok.length) : 0;
  console.log(`  파일 ${ok.length}/${rows.length}, 총행 ${totRows}, GREEN ${green} (${totRows ? Math.round((green / totRows) * 100) : 0}%), 평균 ${lat}ms, 원가 ${cost.toFixed(1)}원\n`);
}

// 상세 CSV
const header = ["file", "model", "foundTable", "rows", "green", "yellow", "red", "needsReview", "mathPass", "tokensIn", "tokensOut", "costKrw", "latencyMs", "error"];
const lines = [header.join(",")];
for (const d of details) {
  lines.push([d.file, d.model, d.foundTable, d.rows, d.green, d.yellow, d.red, d.needsReview, d.mathCheckedPass, d.tokensIn, d.tokensOut, d.costKrw.toFixed(2), d.latencyMs, d.error ?? ""].map(csv).join(","));
}
const csvPath = join(outDir, `${benchRun}.csv`);
writeFileSync(csvPath, lines.join("\n"), "utf8");

// 모델별 요약 JSON
const summary = models.map((model) => {
  const ds = details.filter((d) => d.model === model && !d.error);
  const totRows = ds.reduce((s, d) => s + d.rows, 0);
  return {
    model,
    files: ds.length,
    totalRows: totRows,
    greenPct: totRows ? +((ds.reduce((s, d) => s + d.green, 0) / totRows) * 100).toFixed(1) : 0,
    redPct: totRows ? +((ds.reduce((s, d) => s + d.red, 0) / totRows) * 100).toFixed(1) : 0,
    mathPassPct: totRows ? +((ds.reduce((s, d) => s + d.mathCheckedPass, 0) / totRows) * 100).toFixed(1) : 0,
    needsReview: ds.reduce((s, d) => s + d.needsReview, 0),
    avgLatencyMs: ds.length ? Math.round(ds.reduce((s, d) => s + d.latencyMs, 0) / ds.length) : 0,
    totalCostKrw: +ds.reduce((s, d) => s + d.costKrw, 0).toFixed(1),
    costPerFileKrw: ds.length ? +(ds.reduce((s, d) => s + d.costKrw, 0) / ds.length).toFixed(2) : 0,
  };
});
const jsonPath = join(outDir, `${benchRun}.json`);
writeFileSync(jsonPath, JSON.stringify({ benchRun, models, files: files.length, summary }, null, 2), "utf8");

console.log("== 모델별 요약 ==");
console.table(summary);
console.log(`\n리포트: ${jsonPath}\n상세: ${csvPath}`);
