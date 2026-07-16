import { parse } from "csv-parse";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@platform/db";
import type { DrugRecord, ManufacturerRecord } from "./types.js";

/**
 * HIRA 약가코드 마스터 데이터 로더
 *
 * Cloud SQL `DrugMaster` 테이블(어드민 관리, 약 5.9만 행)에서
 * drug_code(9자리) → DrugRecord Map 을 구성한다. cold start 시 1회 로드 후 캐싱.
 * (파일 CSV 방식에서 전환 — 어드민 업로드/편집 + 약가 API write-through fallback 지원)
 */

function db() {
  return prisma;
}

/** 캐시된 로드 Promise (여러 호출이 동시에 발생해도 1회만 읽도록) */
let loadPromise: Promise<Map<string, DrugRecord>> | null = null;

/** DrugMaster 테이블을 전량 조회해 Map 구성 (cold start 1회). */
export function loadDrugMaster(): Promise<Map<string, DrugRecord>> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const map = new Map<string, DrugRecord>();
    const rows = await db().drugMaster.findMany({
      select: { drugCode: true, drugName: true, manufacturerName: true },
    });
    for (const r of rows) {
      map.set(r.drugCode, {
        drugCode: r.drugCode,
        drugName: r.drugName ?? "",
        manufacturer: r.manufacturerName,
      });
    }
    return map;
  })().catch((err: Error) => {
    loadPromise = null; // 실패 시 재시도 가능하도록 캐시 무효화
    throw new Error(`DrugMaster 로드 실패: ${err.message}`);
  });

  return loadPromise;
}

/** 마스터에서 약가코드로 조회. 없으면 null. */
export async function lookupDrug(code: string): Promise<DrugRecord | null> {
  const map = await loadDrugMaster();
  return map.get(code) ?? null;
}

/** 마스터 캐시를 리셋 (테스트/재로드용). */
export function resetDrugMasterCache(): void {
  loadPromise = null;
  manufacturerLoadPromise = null;
  coMarketingCache = null;
}

// ============================================================
// 코마케팅 표기 오버라이드 (전역) — 약가코드 → 표기 제약사명
// 어드민 관리(CoMarketingMapping, active만). 짧은 TTL 캐시로 변경 반영.
// ============================================================

const CO_MARKETING_TTL_MS = 60_000;
let coMarketingCache: { at: number; map: Map<string, string> } | null = null;

/** 활성 코마케팅 매핑을 Map(drugCode→displayName)으로 로드 (TTL 캐시). */
export async function loadCoMarketing(): Promise<Map<string, string>> {
  const now = Date.now();
  if (coMarketingCache && now - coMarketingCache.at < CO_MARKETING_TTL_MS) {
    return coMarketingCache.map;
  }
  const rows = await db().coMarketingMapping.findMany({
    where: { active: true },
    select: { drugCode: true, displayName: true },
  });
  const map = new Map(rows.map((r) => [r.drugCode, r.displayName]));
  coMarketingCache = { at: now, map };
  return map;
}

/** 코마케팅 표기명 조회. 매핑 없으면 null. */
export async function lookupCoMarketing(code: string): Promise<string | null> {
  return (await loadCoMarketing()).get(code) ?? null;
}

// ============================================================
// 제약사(업체) 마스터 — 업체명 → 사업자번호 등 (v2/추출 API용, 아직 CSV)
// ============================================================

const DEFAULT_MANUFACTURER_MASTER_PATH =
  "/Users/hamelmoon/workspaces/ecso-projects/data/master/manufacturer_master_20260620.csv";

let manufacturerLoadPromise: Promise<Map<string, ManufacturerRecord>> | null = null;

/**
 * 제약사 마스터 CSV(업체명,사업자번호,주소,대표자)를 읽어
 * 업체명 → ManufacturerRecord Map 을 구성한다 (1회 로드 캐싱).
 */
export function loadManufacturerMaster(
  csvPath: string = process.env.MANUFACTURER_MASTER_PATH ?? DEFAULT_MANUFACTURER_MASTER_PATH,
): Promise<Map<string, ManufacturerRecord>> {
  if (manufacturerLoadPromise) return manufacturerLoadPromise;

  const path = resolve(csvPath);
  const map = new Map<string, ManufacturerRecord>();

  manufacturerLoadPromise = new Promise<Map<string, ManufacturerRecord>>(
    (resolvePromise, reject) => {
      const parser = parse({
        columns: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      });

      const stream = createReadStream(path).pipe(parser);

      stream.on("data", (row: Record<string, string>) => {
        const name = row["업체명"]?.trim();
        if (!name) return;
        map.set(name, {
          name,
          businessNumber: row["사업자번호"]?.trim() ?? "",
          address: row["주소"]?.trim() ?? "",
          ceo: row["대표자"]?.trim() ?? "",
        });
      });

      stream.on("end", () => resolvePromise(map));
      stream.on("error", (err: Error) => {
        manufacturerLoadPromise = null;
        reject(new Error(`제약사 마스터 CSV 로드 실패 (${path}): ${err.message}`));
      });
    },
  );

  return manufacturerLoadPromise;
}

/** 제약사 마스터에서 업체명으로 조회. 없으면 null. */
export async function lookupManufacturer(
  name: string,
): Promise<ManufacturerRecord | null> {
  const map = await loadManufacturerMaster();
  return map.get(name) ?? null;
}
