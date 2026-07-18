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
      select: { drugCode: true, drugName: true, manufacturerName: true, unitPrice: true },
    });
    for (const r of rows) {
      map.set(r.drugCode, {
        drugCode: r.drugCode,
        drugName: r.drugName ?? "",
        manufacturer: r.manufacturerName,
        unitPrice: r.unitPrice,
      });
    }
    return map;
  })().catch((err: Error) => {
    loadPromise = null; // 실패 시 재시도 가능하도록 캐시 무효화
    throw new Error(`DrugMaster 로드 실패: ${err.message}`);
  });

  return loadPromise;
}

/** 마스터에서 약가코드로 조회. 미조회 시 약가 API fallback(write-through) 시도. */
export async function lookupDrug(code: string): Promise<DrugRecord | null> {
  const map = await loadDrugMaster();
  const hit = map.get(code);
  if (hit) return hit;

  // fallback: data.go.kr 약가기준정보(15054445) — 키 설정 시에만, fail-safe
  const fetched = await fetchDrugFromApi(code);
  if (fetched) {
    map.set(code, fetched); // in-memory write-through
    // DB write-through(source=hira-api) — best-effort, 조회 흐름 비차단
    db()
      .drugMaster.upsert({
        where: { drugCode: code },
        create: { drugCode: code, manufacturerName: fetched.manufacturer, drugName: fetched.drugName || null, unitPrice: fetched.unitPrice ?? null, source: "hira-api" },
        update: fetched.unitPrice != null ? { unitPrice: fetched.unitPrice } : {}, // 단가 확보 시 갱신
      })
      .catch((e: Error) => console.warn("drugmaster_writethrough_failed:", code, e.message));
    return fetched;
  }
  return null;
}

// ── 약가 API fallback (data.go.kr 15054445 약가기준정보조회서비스) ─────────────
// 미조회 코드만 실시간 조회 → write-through 캐시. 키(HIRA_API_KEY) 없으면 무동작.
// 엔드포인트/필드명은 env로 오버라이드 가능(스펙 확정 전 안전장치). 실패는 항상 null.

// 검증됨(2026-07): 15054445 약가기준정보 getDgamtList — mdsCd/mnfEntpNm/itmNm
const HIRA_API_KEY = process.env.HIRA_API_KEY ?? "";
const HIRA_API_ENDPOINT =
  process.env.HIRA_API_ENDPOINT ?? "https://apis.data.go.kr/B551182/dgamtCrtrInfoService1.2/getDgamtList";
const HIRA_FIELD_MFR = process.env.HIRA_FIELD_MFR ?? "mnfEntpNm"; // 제조업체명
const HIRA_FIELD_NAME = process.env.HIRA_FIELD_NAME ?? "itmNm"; // 제품명
const HIRA_FIELD_CODE = process.env.HIRA_FIELD_CODE ?? "mdsCd"; // 약가코드
// 상한금액(단가) — data.go.kr 15054445 getDgamtList 의 mxCprc (실응답 검증 2026-07).
// 가격과 무관한 필드를 후보로 두면 엉뚱한 값을 단가로 집을 수 있으므로, 검증된 필드만 사용한다.
// 필드명이 바뀌면 HIRA_FIELD_PRICE 로만 오버라이드(추측성 fallback 없음).
const HIRA_FIELD_PRICE = process.env.HIRA_FIELD_PRICE ?? "mxCprc"; // 상한금액
const apiMisses = new Set<string>(); // 부정 캐시(반복 호출 방지, 캐시 리셋 시 비움)

// data.go.kr 동시성 제한 — 대량 추출 시 rate-limit 방지(기본 3).
const API_CONCURRENCY = Number(process.env.HIRA_API_CONCURRENCY ?? 3);
const API_TIMEOUT_MS = Number(process.env.HIRA_API_TIMEOUT_MS ?? 6000);
let apiActive = 0;
const apiWaiters: Array<() => void> = [];
async function apiGate<T>(fn: () => Promise<T>): Promise<T> {
  if (apiActive >= API_CONCURRENCY) await new Promise<void>((res) => apiWaiters.push(res));
  apiActive++;
  try {
    return await fn();
  } finally {
    apiActive--;
    apiWaiters.shift()?.();
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * data.go.kr(15054445) 약가기준정보 단건 조회. 대량 견고성:
 *  - 동시성 제한(apiGate) + 일시적 실패(429/5xx/timeout)는 1회 재시도, **캐시하지 않음**(다음 기회 재시도).
 *  - API 가 정상 응답했는데 결과 비었을 때만 apiMisses 로 캐시(진짜 미존재).
 */
async function fetchDrugFromApi(code: string): Promise<DrugRecord | null> {
  if (!HIRA_API_KEY || apiMisses.has(code)) return null;
  return apiGate(async () => {
    const qs = new URLSearchParams({ serviceKey: HIRA_API_KEY, [HIRA_FIELD_CODE]: code, numOfRows: "1", pageNo: "1", _type: "json" });
    const urlStr = `${HIRA_API_ENDPOINT}?${qs}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetch(urlStr, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
        if (resp.status === 429 || resp.status >= 500) {
          if (attempt === 0) { await sleep(500 + Math.random() * 500); continue; } // 일시적 → 재시도, 캐시 안 함
          return null;
        }
        if (!resp.ok) return null; // 기타 4xx — 캐시 안 함(설정/일시 문제 가능)
        const json: any = await resp.json();
        const items = json?.response?.body?.items?.item ?? json?.items ?? [];
        const item = Array.isArray(items) ? items[0] : items;
        const manufacturer = item?.[HIRA_FIELD_MFR];
        if (!item || !manufacturer) { apiMisses.add(code); return null; } // 정상응답+빈결과 = 진짜 미존재
        let unitPrice: number | null = null;
        const priceRaw = item?.[HIRA_FIELD_PRICE]; // 검증된 mxCprc 만 — 추측성 후보 없음
        if (priceRaw != null) {
          const n = Number(String(priceRaw).replace(/[,\s]/g, ""));
          if (Number.isFinite(n) && n > 0) unitPrice = Math.round(n);
        }
        return { drugCode: code, manufacturer: String(manufacturer), drugName: String(item?.[HIRA_FIELD_NAME] ?? ""), unitPrice };
      } catch (e) {
        if (attempt === 0) { await sleep(500 + Math.random() * 500); continue; } // timeout/network → 재시도
        console.warn("hira_api_fallback_failed:", code, e instanceof Error ? e.message : e);
        return null; // 캐시 안 함
      }
    }
    return null;
  });
}

// ============================================================
// 단가 대조 (검증 전용) — SCD2 이력 반영. OCR 추출값은 절대 바꾸지 않는다.
// 추출 단가가 현재 상한금액과 다르면 과거 버전과 일치하는지(단가 변동) 확인한다.
// ============================================================

export interface PriceMatch {
  /** current=현재가 일치 / historical=과거 버전 일치(단가 변동) / mismatch=어느 버전과도 불일치 / none=마스터 단가 없음 */
  status: "current" | "historical" | "mismatch" | "none";
  currentPrice: number | null; // 현재 상한금액
  matchedPrice: number | null; // 추출값과 일치한 버전의 단가
  validFrom: Date | null; // 일치 버전 유효 시작
  validTo: Date | null; // 일치 버전 유효 종료(null=현재)
}

function within(extracted: number, master: number, tolPct: number): boolean {
  return master > 0 && Math.abs(extracted - master) / master <= tolPct;
}

/**
 * 추출 단가를 마스터(현재 + SCD2 이력)와 대조. 오직 검증 용도 — 값 수정 없음.
 * 우선순위: 현재가 일치 → 과거 버전 일치 → 불일치. 이력 없으면 DrugMaster.unitPrice 로 폴백.
 */
export async function matchDrugPrice(
  code: string,
  extracted: number,
  tolPct = 0.05,
): Promise<PriceMatch> {
  // 이력(SCD2) 우선
  const versions = await db()
    .drugPriceHistory.findMany({
      where: { drugCode: code },
      orderBy: { validFrom: "desc" },
      select: { unitPrice: true, validFrom: true, validTo: true, current: true },
    })
    .catch(() => [] as { unitPrice: number; validFrom: Date; validTo: Date | null; current: boolean }[]);

  if (versions.length > 0) {
    const cur = versions.find((v) => v.current) ?? null;
    const currentPrice = cur?.unitPrice ?? null;
    if (cur && within(extracted, cur.unitPrice, tolPct)) {
      return { status: "current", currentPrice, matchedPrice: cur.unitPrice, validFrom: cur.validFrom, validTo: cur.validTo };
    }
    const hist = versions.find((v) => !v.current && within(extracted, v.unitPrice, tolPct));
    if (hist) {
      return { status: "historical", currentPrice, matchedPrice: hist.unitPrice, validFrom: hist.validFrom, validTo: hist.validTo };
    }
    return { status: currentPrice != null ? "mismatch" : "none", currentPrice, matchedPrice: null, validFrom: null, validTo: null };
  }

  // 이력 없음 → DrugMaster.unitPrice 폴백
  const rec = await lookupDrug(code).catch(() => null);
  const currentPrice = rec?.unitPrice ?? null;
  if (currentPrice == null) return { status: "none", currentPrice: null, matchedPrice: null, validFrom: null, validTo: null };
  if (within(extracted, currentPrice, tolPct)) {
    return { status: "current", currentPrice, matchedPrice: currentPrice, validFrom: null, validTo: null };
  }
  return { status: "mismatch", currentPrice, matchedPrice: null, validFrom: null, validTo: null };
}

/** 마스터 캐시를 리셋 (테스트/재로드용). */
export function resetDrugMasterCache(): void {
  loadPromise = null;
  manufacturerLoadPromise = null;
  coMarketingCache = null;
  apiMisses.clear();
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
