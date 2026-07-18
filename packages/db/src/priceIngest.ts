// 약제급여목록·상한금액표 SCD Type 2 적재 — CLI(backend)·어드민 업로드(portal) 공용.
// 변경분만 새 버전으로 쌓고, 이전 current 를 validTo 로 닫는다. DrugMaster.unitPrice 는 current 비정규화.
import { Prisma, PrismaClient } from "@prisma/client";

export interface PriceRow {
  code: string; // 9자리 제품코드
  price: number; // 상한금액(원)
  name?: string | null;
  mfr?: string | null;
}

export interface IngestOptions {
  validFrom: Date; // 상한금액표 기준일
  batch?: string; // 업로드 배치 식별
}

export interface IngestResult {
  total: number; // 유효 입력 행 수
  inserted: number; // 신규 코드(첫 이력)
  changed: number; // 단가 변경(새 버전 + 이전 close)
  unchanged: number; // 동일 단가(이력 미변경, 마스터명만 갱신)
}

const CHUNK = 1000;

/**
 * 약제급여목록표 2차원 셀 배열 → PriceRow[] (헤더 자동 인식).
 * 컬럼: 제품코드(9자리)·상한금액표 금액·제품명·업체명. exceljs/xlsx 종류 무관하게
 * 워크시트를 (string|number|null)[][] 로 넘기면 파싱한다. 헤더 탐색은 앞쪽 몇 행 스캔.
 */
export function parsePriceSheet(grid: Array<Array<string | number | null | undefined>>): {
  rows: PriceRow[];
  skipped: number;
  headerRow: number;
} {
  const norm = (v: unknown) => String(v ?? "").replace(/\s/g, "");
  const find = (header: Array<string | number | null | undefined>, keys: string[], excludes: string[] = []) => {
    for (let i = 0; i < header.length; i++) {
      const h = norm(header[i]);
      if (!h) continue;
      if (excludes.some((e) => h.includes(e))) continue;
      if (keys.some((k) => h.includes(k))) return i;
    }
    return -1;
  };

  // 헤더 행 탐색 (상한금액/금액 + 코드 컬럼이 함께 잡히는 첫 행)
  let headerRow = -1;
  let ci = -1;
  let pi = -1;
  let ni = -1;
  let mi = -1;
  for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const header = grid[r] ?? [];
    // 제품코드 우선(주성분코드 제외), 없으면 약가/청구코드
    const c = find(header, ["제품코드", "약가코드", "청구코드"], ["주성분"]);
    const p = find(header, ["상한금액", "금액"]);
    if (c !== -1 && p !== -1) {
      headerRow = r;
      ci = c;
      pi = p;
      ni = find(header, ["제품명", "품목명", "제품 명"], ["업체", "성분"]);
      mi = find(header, ["업체명", "제조사", "제약사"]);
      break;
    }
  }
  if (headerRow === -1) return { rows: [], skipped: grid.length, headerRow: -1 };

  const rows: PriceRow[] = [];
  let skipped = 0;
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const code = String(row[ci] ?? "").trim();
    if (!/^\d{9}$/.test(code)) {
      skipped++;
      continue;
    }
    const price = Number(String(row[pi] ?? "").replace(/[,\s]/g, ""));
    if (!Number.isFinite(price)) {
      skipped++;
      continue;
    }
    rows.push({
      code,
      price,
      name: ni >= 0 ? String(row[ni] ?? "").trim() || null : null,
      mfr: mi >= 0 ? String(row[mi] ?? "").trim() || null : null,
    });
  }
  return { rows, skipped, headerRow };
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * SCD2 적재. 같은 code 가 입력에 여러 번 오면 마지막 값을 채택(중복 제거).
 * 절차: 현재 이력 로드 → (신규/변경/동일) 분류 → 변경분 close → 신규+변경 insert → DrugMaster 비정규화 upsert.
 */
export async function ingestDrugPriceTable(
  prisma: PrismaClient,
  rowsIn: PriceRow[],
  opts: IngestOptions,
): Promise<IngestResult> {
  // 유효행 + 코드 중복 제거(마지막 우선)
  const map = new Map<string, PriceRow>();
  for (const r of rowsIn) {
    if (!/^\d{9}$/.test(r.code)) continue;
    if (!Number.isFinite(r.price)) continue;
    map.set(r.code, { ...r, price: Math.round(r.price) });
  }
  const rows = [...map.values()];
  const codes = [...map.keys()];
  const validFrom = opts.validFrom;
  const batch = opts.batch ?? null;

  // 현재 유효 단가 로드 (code → unitPrice)
  const currentPrice = new Map<string, number>();
  for (const c of chunk(codes, 2000)) {
    const existing = await prisma.drugPriceHistory.findMany({
      where: { current: true, drugCode: { in: c } },
      select: { drugCode: true, unitPrice: true },
    });
    for (const e of existing) currentPrice.set(e.drugCode, e.unitPrice);
  }

  const changedCodes: string[] = [];
  const newCodes: string[] = [];
  let unchanged = 0;
  for (const r of rows) {
    if (!currentPrice.has(r.code)) newCodes.push(r.code);
    else if (currentPrice.get(r.code) !== r.price) changedCodes.push(r.code);
    else unchanged++;
  }

  // 1) 변경 코드의 이전 current 를 닫는다
  for (const c of chunk(changedCodes, CHUNK)) {
    await prisma.drugPriceHistory.updateMany({
      where: { current: true, drugCode: { in: c } },
      data: { current: false, validTo: validFrom },
    });
  }

  // 2) 신규 + 변경 코드의 새 current 이력 insert
  const toInsert = new Set([...newCodes, ...changedCodes]);
  const insertRows = rows.filter((r) => toInsert.has(r.code));
  for (const c of chunk(insertRows, CHUNK)) {
    await prisma.drugPriceHistory.createMany({
      data: c.map((r) => ({
        drugCode: r.code,
        unitPrice: r.price,
        drugName: r.name ?? null,
        manufacturerName: r.mfr ?? null,
        batch,
        validFrom,
        validTo: null,
        current: true,
      })),
    });
  }

  // 3) DrugMaster 비정규화 upsert (전 입력행 — 단가/기준일/명칭 갱신)
  for (const c of chunk(rows, CHUNK)) {
    const values = c.map(
      (r) =>
        Prisma.sql`(${r.code}, ${r.mfr ?? ""}, ${r.name ?? null}, ${r.price}, ${validFrom}, 'price-table', NOW())`,
    );
    await prisma.$executeRaw`
      INSERT INTO "DrugMaster" ("drugCode", "manufacturerName", "drugName", "unitPrice", "priceEffectiveFrom", "source", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("drugCode") DO UPDATE SET
        "unitPrice" = EXCLUDED."unitPrice",
        "priceEffectiveFrom" = EXCLUDED."priceEffectiveFrom",
        "manufacturerName" = CASE WHEN EXCLUDED."manufacturerName" <> '' THEN EXCLUDED."manufacturerName" ELSE "DrugMaster"."manufacturerName" END,
        "drugName" = COALESCE(EXCLUDED."drugName", "DrugMaster"."drugName"),
        "source" = 'price-table',
        "updatedAt" = NOW()
    `;
  }

  return { total: rows.length, inserted: newCodes.length, changed: changedCodes.length, unchanged };
}
