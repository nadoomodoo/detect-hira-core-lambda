import { parse } from "csv-parse";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import type { DrugRecord, ManufacturerRecord } from "./types.js";

/**
 * HIRA 약가코드 마스터 데이터 로더
 *
 * drug_master_merged.csv (약 5.9만 행) 를 읽어 drug_code(9자리) → DrugRecord Map 구성.
 * 모듈 수준에서 1회만 로드하고 캐싱한다 (Promise 기반 lazy init).
 */

const DEFAULT_MASTER_PATH =
  "/Users/hamelmoon/workspaces/ecso-projects/data/master/drug_master_merged.csv";

/** 캐시된 로드 Promise (여러 호출이 동시에 발생해도 1회만 읽도록) */
let loadPromise: Promise<Map<string, DrugRecord>> | null = null;

/**
 * 마스터 CSV 를 스트림으로 읽어 Map 을 구성한다.
 * - 첫 줄은 BOM(\uFEFF) 이 붙을 수 있어 헤더를 정규화한다.
 * - drug_code 가 비어있거나 숫자가 아닌 행은 건너뛴다.
 */
export function loadDrugMaster(
  csvPath: string = process.env.DRUG_MASTER_PATH ?? DEFAULT_MASTER_PATH,
): Promise<Map<string, DrugRecord>> {
  // 동시 호출 시 동일한 Promise 재사용
  if (loadPromise) return loadPromise;

  const path = resolve(csvPath);
  const map = new Map<string, DrugRecord>();

  loadPromise = new Promise<Map<string, DrugRecord>>((resolvePromise, reject) => {
    const parser = parse({
      columns: true,
      trim: true,
      bom: true, // 헤더의 BOM 자동 제거
      relax_column_count: true, // 컬럼 수 불일치 행 허용 (메모 컬럼 등)
    });

    const stream = createReadStream(path).pipe(parser);

    stream.on("data", (row: Record<string, string>) => {
      const drugCode = row["drug_code"]?.trim();
      if (!drugCode || !/^\d{9}$/.test(drugCode)) return; // 9자리 숫자만

      map.set(drugCode, {
        drugCode,
        drugName: row["drug_name"]?.trim() ?? "",
        manufacturer: row["manufacturer"]?.trim() ?? "",
      });
    });

    stream.on("end", () => {
      resolvePromise(map);
    });

    stream.on("error", (err: Error) => {
      loadPromise = null; // 실패 시 재시도 가능하도록 캐시 무효화
      reject(new Error(`마스터 CSV 로드 실패 (${path}): ${err.message}`));
    });
  });

  return loadPromise;
}

/** 마스터에서 약가코드로 조회. 없으면 null. */
export async function lookupDrug(
  code: string,
): Promise<DrugRecord | null> {
  const map = await loadDrugMaster();
  return map.get(code) ?? null;
}

/** 마스터 캐시를 리셋 (테스트/재로드용). */
export function resetDrugMasterCache(): void {
  loadPromise = null;
  manufacturerLoadPromise = null;
}

// ============================================================
// 제약사(업체) 마스터 — 업체명 → 사업자번호 등
// ============================================================

const DEFAULT_MANUFACTURER_MASTER_PATH =
  "/Users/hamelmoon/workspaces/ecso-projects/data/master/manufacturer_master_20260620.csv";

let manufacturerLoadPromise: Promise<Map<string, ManufacturerRecord>> | null = null;

/**
 * 제약사 마스터 CSV(업체명,사업자번호,주소,대표자)를 읽어
 * 업체명 → ManufacturerRecord Map 을 구성한다 (1회 로드 캐싱).
 * drug master 의 manufacturer(업체명 문자열)와 정확 일치로 조인 (매칭률 ~97%).
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
