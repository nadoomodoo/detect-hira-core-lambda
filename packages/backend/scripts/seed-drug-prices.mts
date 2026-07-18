/**
 * 약제급여목록·상한금액표(xlsx) → DrugMaster 단가 + DrugPriceHistory(SCD2) 적재.
 *   npx tsx --env-file=../../.env scripts/seed-drug-prices.mts [xlsx경로] [--from=YYYY-MM-DD]
 * 기본 파일: data/약제급여목록및급여상한금액표_*.xlsx, 기준일은 파일명에서 (YYYY.M.D) 추출.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { prisma, ingestDrugPriceTable, parsePriceSheet } from "@platform/db";

const REPO = "/Users/hamelmoon/workspaces/detect-hira-code";
const args = process.argv.slice(2);
const fromArg = args.find((a) => a.startsWith("--from="))?.slice(7);
const pathArg = args.find((a) => !a.startsWith("--"));

// macOS 파일명은 NFD 정규화라, 한글 매칭 전에 NFC 로 정규화한다.
const found = pathArg
  ? null
  : readdirSync(join(REPO, "data")).find((f) => /약제급여목록.*\.xlsx$/.test(f.normalize("NFC")));
const file = pathArg ?? (found ? join(REPO, "data", found) : "");
if (!file) {
  console.error("xlsx 파일을 찾지 못했습니다. 경로를 인자로 전달하세요.");
  process.exit(1);
}
console.log("파일:", file);

// 기준일: --from 우선, 없으면 파일명의 (YYYY.M.D) → Date
function effectiveFrom(): Date {
  if (fromArg) return new Date(fromArg);
  const m = file.match(/\((\d{4})\.(\d{1,2})\.(\d{1,2})\.?\)/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date();
}
const validFrom = effectiveFrom();
console.log("기준일(validFrom):", validFrom.toISOString().slice(0, 10));

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.worksheets[0];
const grid: Array<Array<string | number | null>> = [];
ws.eachRow({ includeEmpty: false }, (row) => {
  const arr: Array<string | number | null> = [];
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    arr[col - 1] = (cell.text ?? "") as string;
  });
  grid.push(arr);
});
console.log("시트 행:", grid.length);

const { rows, skipped, headerRow } = parsePriceSheet(grid);
console.log(`파싱: 유효 ${rows.length}행, 스킵 ${skipped}행 (헤더행 index ${headerRow})`);
if (rows.length === 0) {
  console.error("유효 행이 없습니다. 컬럼(제품코드/상한금액) 인식 실패.");
  process.exit(1);
}

const batch = file.split("/").pop() ?? "price-table";
const t0 = Date.now();
const res = await ingestDrugPriceTable(prisma, rows, { validFrom, batch });
console.log(
  `\n적재 완료 (${Date.now() - t0}ms): 총 ${res.total} · 신규 ${res.inserted} · 변경 ${res.changed} · 동일 ${res.unchanged}`,
);

const withPrice = await prisma.drugMaster.count({ where: { unitPrice: { not: null } } });
const hist = await prisma.drugPriceHistory.count({ where: { current: true } });
console.log(`DrugMaster 단가 보유: ${withPrice.toLocaleString()}건 · DrugPriceHistory current: ${hist.toLocaleString()}건`);
await prisma.$disconnect();
process.exit(0);
