import sharp from "sharp";
import { preprocessImage, applyRotation } from "./preprocess.js";
import { cropTable, type CropMeta } from "./cropClient.js";
import { generateJson, parseJsonLoose } from "./gemini.js";
import { mapTable, parseNumber, isSummaryRow, isEmptyRow, codesMatchByTruncation, inferColumnRolesByMaster, fieldLabel, type MappedRow } from "./mapping.js";
import { lookupDrug, matchDrugPrice } from "./master.js";
import { validateRows, validateRow, checkMathParts, tallyTrafficLights, type ValidatedRow } from "./validate.js";
import { resolveTemplate, DEFAULT_RECROP_PROMPT, DEFAULT_RECROP_SCHEMA, type ResolvedTemplate } from "./templates.js";
import { detectHiraCodes, detectRotation, shouldApplyRotation } from "./ocr.js";
import { classifyDocument, type DocumentType } from "./doctype.js";
import { toPixelBox } from "./annotate.js";
import { computeCost } from "./pricing.js";

/**
 * EDI 이미지 → 크롭 → 표 추출 → 매핑 → 검증 오케스트레이션.
 *
 * 파이프라인:
 *   preprocess → crop-svc(RT-DETR) → Gemini 표 추출(DB 템플릿) → 컬럼 매핑(밀림 복구)
 *   → 항목별 검증(산술/마스터단가/신호등) → (RED/누락 행) 약가코드 앵커 재크롭 2차 pass
 *
 * 원가는 단계별(stage)로 집계해 반환한다(caller 가 UsageCost 로 적재).
 */

export interface StageCost {
  stage: string; // crop | extract | detect | recrop
  model: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  costKrw: number;
  latencyMs: number;
}

export interface ExtractResult {
  foundTable: boolean;
  /** 문서 유형 — drug_table | business_registration | prescription | receipt | other | unknown */
  documentType: DocumentType;
  /** 이미지 자체 품질 판단(프롬프트) — readable/issues/note. 재촬영·신뢰도 판단용. */
  imageQuality: ImageQuality;
  /** 적용된 회전각(0/90/180/270). */
  appliedRotation: number;
  /** 크롭이 표를 못 잡아 원본으로 재추출했는지. */
  fullImageRetry: boolean;
  columns: string[];
  rows: ValidatedRow[];
  cropMeta: CropMeta;
  template: { id: string | null; key: string; version: number | null };
  tallies: { green: number; yellow: number; red: number };
  costs: StageCost[];
  /** 추출된 원본 헤더(감사) */
  columnsRaw: string[];
  /** 합계/요약 행으로 판별돼 항목에서 분리된 행 수 */
  summaryRowCount: number;
  /** 완전성 검증(전체 표 추출 여부) — 합계행 총금액 vs 추출행 총금액 합 대조 */
  completeness: {
    grandTotal: number | null; // 문서 합계행의 총금액(감지 시)
    extractedTotal: number; // 추출 행 총금액 합
    complete: boolean | null; // true=일치(전체추출) / false=누락의심 / null=합계 없어 판단불가
  };
}

export interface ExtractOptions {
  templateId?: string | null;
  /** 추출 모델 강제 지정(벤치마크용). 없으면 템플릿/env 기본. */
  modelOverride?: string;
  /** 약가코드 앵커 재크롭 2차 pass 사용 여부. 기본 env EXTRACT_RECROP!=off. */
  recrop?: boolean;
  /** 재크롭 대상 최대 행 수(원가 폭주 방지). 기본 env EXTRACT_RECROP_MAX 또는 12. */
  recropMax?: number;
}

export interface ImageQuality {
  /** 표의 숫자를 신뢰성 있게 읽을 수 있는가 */
  readable: boolean;
  /** blur|dark|glare|skew|rotated|partial|low_res|noise */
  issues: string[];
  note?: string;
}

interface ExtractRaw {
  found_drug_table?: boolean;
  image_quality?: { readable?: boolean; issues?: unknown; note?: unknown };
  columns?: string[];
  rows?: Array<string[] | Record<string, unknown>>;
}

function parseQuality(q: ExtractRaw["image_quality"]): ImageQuality {
  const issues = Array.isArray(q?.issues) ? q!.issues.map((x) => String(x)).filter(Boolean) : [];
  return {
    readable: q?.readable !== false, // 명시적 false 만 불량, 미보고는 readable 간주
    issues,
    note: typeof q?.note === "string" ? q.note : undefined,
  };
}

/** 메인 추출 엔트리. */
export async function extractEdi(
  imageBuffer: Buffer,
  mimeType: string,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const costs: StageCost[] = [];

  // 0) 회전 판별/보정 (hira-detect 파이프라인과 동일 — Gemini 기반).
  //    크롭 전에 정방향으로 세워 크롭·추출·원본재시도가 모두 바른 방향을 본다.
  let workBuf = imageBuffer;
  let appliedRotation = 0;
  if (process.env.EXTRACT_ROTATION !== "off") {
    try {
      const preRot = await preprocessImage(imageBuffer);
      const rot = await detectRotation(preRot.buffer, preRot.mimeType);
      if (shouldApplyRotation(rot)) {
        const r = await applyRotation(imageBuffer, rot.rotation);
        workBuf = r.buffer;
        appliedRotation = rot.rotation;
      }
    } catch {
      // 회전 판별 실패 — 원본 그대로 진행
    }
  }

  // 1) 전처리 (회전 보정본 기준)
  const pre = await preprocessImage(workBuf);

  // 2) 크롭(RT-DETR 사이드카) — fail-open
  const cropped = await cropTable(pre.buffer, pre.mimeType);

  // 3) 템플릿 해석
  const template = await resolveTemplate({ templateId: opts.templateId });
  const model = opts.modelOverride ?? template.model ?? undefined;
  const temperature = numOr(template.params?.temperature, 0);

  // 4) Gemini 표 추출 — 한 이미지에 대해 1회 실행 (modelOverride 로 상위 모델 에스컬레이션 가능)
  const runOnce = async (buffer: Buffer, mime: string, stage: string, modelOverride?: string) => {
    const gen = await generateJson({
      model: modelOverride ?? model,
      imageBuffer: buffer,
      mimeType: mime,
      prompt: template.body,
      responseSchema: template.responseSchema,
      temperature,
    });
    costs.push(stageCost(stage, gen));
    const raw = parseJsonLoose<ExtractRaw>(gen.text) ?? {};
    return {
      foundTable: raw.found_drug_table === true,
      quality: parseQuality(raw.image_quality),
      columns: Array.isArray(raw.columns) ? raw.columns.map((c) => String(c)) : [],
      rawRows: Array.isArray(raw.rows) ? raw.rows : ([] as Array<string[] | Record<string, unknown>>),
    };
  };

  // 크롭본에서 먼저 시도
  let res = await runOnce(cropped.buffer, cropped.mimeType, "extract");
  let extractBuffer = cropped.buffer; // 표를 실제로 얻은 이미지(재크롭 앵커 기준)
  let extractMime = cropped.mimeType;
  let fullImageRetry = false;
  // 크롭이 실제로 적용됐는데(폴백 아님) 표를 못 찾거나, 프롬프트가 "표 일부 잘림(partial)"으로
  // 판단하면 원본(전처리본)으로 재시도. 크롭은 인식 보조일 뿐 — 잘못 잘려도 추출은 되어야 한다.
  const cropMayHaveCut = res.quality.issues.includes("partial");
  if ((!res.foundTable || res.rawRows.length === 0 || cropMayHaveCut) && !cropped.meta.fallback) {
    const retry = await runOnce(pre.buffer, pre.mimeType, "extract-fullimage");
    const recovered = !res.foundTable || res.rawRows.length === 0; // 크롭이 아예 실패했던 경우
    const lessCut = cropMayHaveCut && retry.rawRows.length > res.rawRows.length; // 잘림 → 원본이 더 많은 행
    if (retry.foundTable && retry.rawRows.length > 0 && (recovered || lessCut)) {
      res = retry;
      extractBuffer = pre.buffer;
      extractMime = pre.mimeType;
      fullImageRetry = true;
    }
  }
  const { foundTable, rawRows, quality: imageQuality } = res;
  let columns = res.columns;

  // 4.5) 표가 없으면 문서 유형 분류 (사업자등록증 등 비-약품문서 triage).
  //      대량 업로드에서 "약품표 아님"을 명확히 라벨링해 사용자가 걸러낼 수 있게 한다.
  let documentType: DocumentType = foundTable ? "drug_table" : "unknown";
  if (!foundTable && process.env.EXTRACT_DOCTYPE !== "off") {
    documentType = await classifyDocument(pre.buffer, pre.mimeType, costs).catch(() => "unknown");
  }

  // 5) 컬럼 매핑 → 합계/빈행 분리 + 중복 제거 → 검증 (recrop 전). 재추출 비교를 위해 헬퍼화.
  const buildRows = async (cols: string[], raws: Array<string[] | Record<string, unknown>>) => {
    const mappedAll = mapTable(cols, raws);
    const drop = new Set<MappedRow>();
    for (const r of mappedAll) if (isSummaryRow(r) || isTotalsRow(r, mappedAll) || isEmptyRow(r)) drop.add(r);
    const seen = new Set<string>();
    const kept: MappedRow[] = [];
    for (const r of mappedAll) {
      if (drop.has(r)) continue;
      const sig = [r.drugCode, r.quantity, r.days, r.prescribedQty, r.unitPrice, r.totalAmount].join("|");
      if (r.drugCode && seen.has(sig)) { drop.add(r); continue; }
      seen.add(sig);
      kept.push(r);
    }
    return { rows: await validateRows(kept), summaryRows: [...drop] };
  };
  const grandOf = (sr: MappedRow[]) => sr.map((r) => r.totalAmount).filter((v): v is number => v != null && v > 0).sort((a, b) => b - a)[0] ?? null;
  const sumOf = (rs: ValidatedRow[]) => rs.reduce((s, r) => s + (r.totalAmount ?? 0), 0);
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.01);

  let { rows, summaryRows } = await buildRows(columns, rawRows);
  let extractBuffer2 = extractBuffer;
  let extractMime2 = extractMime;

  // P3 완전성 사전판정: 합계행 총금액 vs 추출 합. 불일치(누락 의심) + 크롭 적용 + 미재시도면
  // 원본 전체로 재추출해 더 완전한 쪽 채택(크롭이 일부 행을 잘랐을 수 있음).
  {
    const g = grandOf(summaryRows);
    const incomplete = g != null && !near(sumOf(rows), g);
    if (incomplete && !fullImageRetry && !cropped.meta.fallback) {
      const alt = await runOnce(pre.buffer, pre.mimeType, "extract-complete");
      if (alt.foundTable && alt.rawRows.length > 0) {
        const ar = await buildRows(alt.columns, alt.rawRows);
        const ag = grandOf(ar.summaryRows);
        const altComplete = ag != null && near(sumOf(ar.rows), ag);
        if (altComplete || ar.rows.length > rows.length) {
          rows = ar.rows;
          summaryRows = ar.summaryRows;
          columns = alt.columns;
          extractBuffer2 = pre.buffer;
          extractMime2 = pre.mimeType;
          fullImageRetry = true;
        }
      }
    }
  }

  // "나쁨" 지표 — RED이거나 값-패턴 재식별(reassigned)된 행 비율. 헤더 부실/숫자 오독 신호.
  const badRatio = (rs: ValidatedRow[]) =>
    rs.length ? rs.filter((r) => r.trafficLight === "RED" || r.reassigned).length / rs.length : 0;
  const badThreshold = Number(process.env.EXTRACT_ESCALATE_BAD_RATIO ?? process.env.EXTRACT_ESCALATE_REASSIGN_RATIO ?? 0.3);

  // 6.4) 마스터 앵커 컬럼 역할 추정 — 헤더가 없거나 부실해 결과가 나쁘면, VLM 재호출 없이
  //      로컬 약가 마스터로 컬럼 역할을 역산한다(값 조작 없음, 라벨만 부여 후 재매핑).
  //      코드 열의 약가와 일치하는 열=단가, A≈B×단가면 A=총금액·B=수량/총처방량. 저렴 → 에스컬레이션보다 먼저.
  if (process.env.EXTRACT_COLINFER !== "off" && foundTable && rows.length > 0 && badRatio(rows) >= badThreshold) {
    const toCells = (r: string[] | Record<string, unknown>): string[] =>
      Array.isArray(r)
        ? r.map((c) => (c == null ? "" : String(c)))
        : columns.map((col) => { const v = (r as Record<string, unknown>)[col]; return v == null ? "" : String(v); });
    const cells = rawRows.map(toCells);
    const codeOf = (cs: string[]) => { for (const c of cs) { const m = String(c).match(/\b(\d{8,10})\b/); if (m) return m[1]; } return null; };
    const prices = await Promise.all(
      cells.map(async (cs) => { const code = codeOf(cs); return code ? (await lookupDrug(code).catch(() => null))?.unitPrice ?? null : null; }),
    );
    const inferred = inferColumnRolesByMaster(columns, cells, prices);
    if (inferred.changed) {
      const cand = await buildRows(inferred.columns, rawRows);
      if (badRatio(cand.rows) < badRatio(rows)) {
        rows = cand.rows;
        summaryRows = cand.summaryRows;
        columns = inferred.columns;
      }
    }
  }

  // 6.5) 상위 모델 에스컬레이션 — 헤더 매핑 실패(reassigned 다수)로 위(마스터 앵커)로도 못 잡을 때만
  //      더 강한 모델로 전체 재추출(thinking off 기본). RED 다수는 트리거 안 함 — 밀집표 열 누락처럼
  //      상위 모델로도 못 고치는데 헛돈(비쌈)이 되기 때문. 재추출이 덜 나쁘거나(품질↑) 품질 유지하며
  //      더 완전(행↑)할 때만 채택. 정상 케이스 미발동. env EXTRACT_ESCALATE=off.
  const reassignRatio = (rs: ValidatedRow[]) => (rs.length ? rs.filter((r) => r.reassigned).length / rs.length : 0);
  if (
    process.env.EXTRACT_ESCALATE !== "off" &&
    foundTable &&
    rows.length > 0
  ) {
    const escalateModel = process.env.EXTRACT_ESCALATE_MODEL ?? "gemini-3.5-flash";
    const threshold = badThreshold;
    const before = badRatio(rows); // 채택 비교는 RED+reassigned 종합 품질로
    if ((model ?? "") !== escalateModel && reassignRatio(rows) >= threshold) {
      const esc = await runOnce(extractBuffer2, extractMime2, "extract-escalate", escalateModel);
      if (esc.foundTable && esc.rawRows.length > 0) {
        const er = await buildRows(esc.columns, esc.rawRows);
        const after = badRatio(er.rows);
        // 더 깨끗하거나(품질↑), 품질 안 나빠지며 더 완전(행↑)할 때만 채택 — 더 나쁜 결과는 버림.
        if (after < before || (after <= before && er.rows.length > rows.length)) {
          rows = er.rows;
          summaryRows = er.summaryRows;
          columns = esc.columns;
        }
      }
    }
  }

  // 7) 약가코드 앵커 재크롭(§8) — RED/산술불일치 행 2차 pass (최종 채택 이미지 기준, 1회)
  const useRecrop = opts.recrop ?? process.env.EXTRACT_RECROP !== "off";
  if (useRecrop && foundTable) {
    const recropMax = opts.recropMax ?? Number(process.env.EXTRACT_RECROP_MAX ?? 12);
    rows = await recropPass(extractBuffer2, rows, model, recropMax, costs);
  }

  const tallies = tallyTrafficLights(rows);
  const grandTotal = grandOf(summaryRows);
  const extractedTotal = sumOf(rows);
  const complete = grandTotal == null ? null : near(extractedTotal, grandTotal);

  return {
    foundTable,
    documentType,
    imageQuality,
    completeness: { grandTotal, extractedTotal, complete },
    appliedRotation,
    fullImageRetry,
    columns,
    columnsRaw: columns,
    rows,
    cropMeta: { ...cropped.meta, applied_rotation: appliedRotation || cropped.meta.applied_rotation },
    template: { id: template.id, key: template.key, version: template.version },
    tallies,
    costs,
    summaryRowCount: summaryRows.length,
  };
}

/** 제한 동시성 map (recrop 밴드 병렬 처리용). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * 약가코드 앵커 재크롭 2차 pass.
 * - hira-detect(detectHiraCodes)로 크롭 이미지의 코드별 위치(box_2d) 확보 — 코드는 잘 읽힌다.
 * - RED 행 또는 검출됐지만 추출표에 없는 코드에 대해, 코드 y중심 밴드를 표 폭 전체로 잘라
 *   단일행 전용 프롬프트로 숫자만 재추출.
 * - 성능: 밴드들을 병렬(EXTRACT_RECROP_CONCURRENCY, 기본 5)로 재추출(Phase1)한 뒤,
 *   순차로 out 에 결정적 집계(Phase2). 순차 처리 시 밀집표가 프로세서 타임아웃을 넘던 문제 해소.
 */
async function recropPass(
  croppedBuffer: Buffer,
  rows: ValidatedRow[],
  model: string | undefined,
  recropMax: number,
  costs: StageCost[],
): Promise<ValidatedRow[]> {
  // 코드 검출 (전역 usage 버킷에 집계됨 — 원가는 detect 단계로 별도 근사 불가하므로 생략 가능)
  let dets;
  try {
    dets = await detectHiraCodes(croppedBuffer, "image/png");
  } catch {
    return rows; // 검출 실패 시 1차 결과 유지
  }
  if (dets.length === 0) return rows;

  const meta = await sharp(croppedBuffer).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W === 0 || H === 0) return rows;

  // 코드 → 대표 box (같은 코드 여러 위치면 첫 번째)
  const boxByCode = new Map<string, [number, number, number, number]>();
  for (const d of dets) if (!boxByCode.has(d.code)) boxByCode.set(d.code, d.box);

  const byCode = new Map<string, ValidatedRow>();
  for (const r of rows) if (r.drugCode) byCode.set(r.drugCode, r);

  // 좌표 앵커: 1차 추출 행 자체엔 좌표가 없다. 코드가 detect 로 그대로 잡힌 행만 그 코드
  // box 의 세로 위치를 앵커로 얻는다(rows 인덱스 = out 인덱스, 원본 행은 in-place 갱신·append 로
  // 인덱스 보존). 코드가 오독(전치 등)된 행은 앵커가 없으므로, 뒤에서 이웃 앵커 사이 갭으로 보간한다.
  const anchorBand = new Map<number, [number, number, number, number]>();
  rows.forEach((r, i) => {
    const b = r.drugCode ? boxByCode.get(r.drugCode) : undefined;
    if (b) anchorBand.set(i, b);
  });

  // 표가 표준(9자리 HIRA) 코드 위주인지 판별. 내부코드(대학병원·의원 자체코드) 위주 표에서는
  // detectHiraCodes 가 찾은 9자리 코드가 "누락된 행"이 아니라 이미 내부코드로 추출된 동일 행의
  // 다른 코드표현일 뿐이다. 이때 (b) 분기로 새 행을 추가하면 같은 라인이 이중 계상된다(중복 버그).
  const codedRows = rows.filter((r) => r.drugCode);
  const hiraCoded = rows.filter((r) => r.codeType === "hira");
  const tableUsesStandardCodes = codedRows.length === 0 || hiraCoded.length >= codedRows.length / 2;

  // 재크롭 대상: (a) RED 또는 산술불일치(자릿수 절단 의심) 행 중 코드 검출된 것, (b) 검출됐지만 표에 없는 코드
  const targets: string[] = [];
  for (const r of rows) {
    const needsRecrop = r.trafficLight === "RED" || r.mathValid === false;
    if (needsRecrop && r.drugCode && boxByCode.has(r.drugCode)) targets.push(r.drugCode);
  }
  // (b) 는 표가 표준코드 위주일 때만 — 내부코드 표에서는 중복 유발이라 건너뛴다.
  if (tableUsesStandardCodes) {
    for (const code of boxByCode.keys()) {
      if (!byCode.has(code)) targets.push(code);
    }
  }
  const uniqueTargets = [...new Set(targets)].slice(0, recropMax);
  if (uniqueTargets.length === 0) return rows;

  // 밴드 재추출은 상위 모델로 에스컬레이션(lite 섞기) — 작은 밴드라 3.5-flash 라도 빠르고 저렴.
  // EXTRACT_RECROP_MODEL 로 조정(기본 gemini-3.5-flash). lite 로 두면 에스컬레이션 없음.
  const recropModel = process.env.EXTRACT_RECROP_MODEL ?? "gemini-3.5-flash";

  const concurrency = Math.max(1, Number(process.env.EXTRACT_RECROP_CONCURRENCY ?? 5));

  // Phase 1 (병렬): 각 코드 밴드 크롭 + 재추출. 결과만 수집(공유 out 미변경 → race 없음).
  const bandResults = await mapLimit(uniqueTargets, concurrency, async (code) => {
    const box = boxByCode.get(code);
    if (!box) return null;
    const band = await cropBand(croppedBuffer, box, W, H);
    if (!band) return null;
    try {
      const gen = await generateJson({
        model: recropModel,
        imageBuffer: band,
        mimeType: "image/png",
        prompt: DEFAULT_RECROP_PROMPT.replace(/\{CODE\}/g, code),
        responseSchema: DEFAULT_RECROP_SCHEMA,
      });
      costs.push(stageCost("recrop", gen));
      const r = parseJsonLoose<Record<string, unknown>>(gen.text);
      if (!r) return null;
      const rc = {
        quantity: parseNumber(r.quantity as any, "count"),
        days: parseNumber(r.days as any, "count"),
        prescribedQty: parseNumber(r.prescribed_qty as any, "count"),
        unitPrice: parseNumber(r.unit_price as any, "money"),
        totalAmount: parseNumber(r.total_amount as any, "money"),
      };
      return { code, r, rc };
    } catch {
      return null; // 재크롭 실패 — 해당 코드 건너뜀
    }
  });

  // Phase 2 (순차 집계·aggregation): 병렬 결과를 out 에 결정적으로 반영(병합·충돌해소·신규행).
  const out = [...rows];
  for (const res of bandResults) {
    if (!res) continue;
    const { code, r, rc } = res;

      const existingIdx = out.findIndex((x) => x.drugCode === code);
      if (existingIdx !== -1) {
        // ── 기존 행 교차검증·증강 (교체 아님) ──
        // 정본=1차 OCR 값. 필드별로: 1차 없음→recrop 로 채움(증강), 둘 다 있고 다름→충돌.
        const prev = out[existingIdx];
        const NUM = ["quantity", "days", "prescribedQty", "unitPrice", "totalAmount"] as const;
        const merged: MappedRow = { ...prev };
        const conflicts: (typeof NUM)[number][] = [];
        for (const f of NUM) {
          const a = prev[f];
          const b = rc[f];
          if (a == null && b != null) merged[f] = b; // 증강
          else if (a != null && b != null && a !== b) conflicts.push(f); // 충돌(정본 유지)
          // 일치 or recrop 없음 → 정본 유지
        }

        const chosen: MappedRow = { ...merged };
        const reviewNotes: string[] = [];
        if (conflicts.length > 0) {
          // 충돌 → 필드 그룹별로 독립 산술 판정(방정식 분리). 한 그룹(예: 수량 삼중항)이
          // 깨져도 다른 그룹(금액)의 승자 선택을 오염시키지 않는다. 이게 안 되면 금액식이
          // 옳은 recrop 값을 골라야 할 때도 수량 불일치 때문에 1차 쓰레기가 살아남는다.
          const AMOUNT = ["unitPrice", "totalAmount"] as const;
          const QTY = ["quantity", "days", "prescribedQty"] as const;
          const resolveGroup = (
            group: readonly (typeof conflicts)[number][],
            part: "amount" | "qty",
          ) => {
            const gf = conflicts.filter((f) => (group as readonly string[]).includes(f));
            if (gf.length === 0) return;
            const vMain: MappedRow = { ...chosen };
            const vRc: MappedRow = { ...chosen };
            for (const f of gf) vRc[f] = rc[f];
            const pMain = checkMathParts(vMain)[part];
            const pRc = checkMathParts(vRc)[part];
            const okMain = pMain.checked && pMain.valid;
            const okRc = pRc.checked && pRc.valid;
            if (okRc && !okMain) {
              for (const f of gf) chosen[f] = rc[f]; // recrop 이 이 식을 통과 → 채택
            } else if (okMain && !okRc) {
              // 1차 유지
            } else {
              // 판정 불가(둘 다 통과/실패) → 1차 유지 + 확인필요
              reviewNotes.push(...gf.map((f) => `${fieldLabel(f)} 값 확인 필요 — 판독값(${prev[f]})과 재판독값(${rc[f]})이 달라 원본 확인이 필요합니다`));
            }
          };
          resolveGroup(AMOUNT, "amount");
          resolveGroup(QTY, "qty");
        }

        const validated = await validateRow(chosen);
        validated.recropPass = true;
        if (reviewNotes.length > 0) {
          validated.needsReview = true;
          validated.reviewFlags = [...validated.reviewFlags, ...reviewNotes];
        }
        out[existingIdx] = validated;
      } else {
        // ── orphan 코드(검출됐지만 표에 없음) ──
        // ① 좌표 앵커 코드 교정: 기존 행 코드가 이 검출 9자리의 절단/접두(같은 물리 행을 코드 오독)면,
        //    새 행이 아니라 그 행의 코드를 검출값으로 교정 + 밴드로 증강(통계표 등 중복행 방지).
        const truncIdx = out.findIndex((x) => codesMatchByTruncation(x.drugCode, code));
        if (truncIdx !== -1) {
          const prev = out[truncIdx];
          const merged: MappedRow = { ...prev, drugCode: code };
          const NUM = ["quantity", "days", "prescribedQty", "unitPrice", "totalAmount"] as const;
          for (const f of NUM) if (merged[f] == null && rc[f] != null) merged[f] = rc[f];
          merged.reassigned = true; // 코드 교정 개입 표시
          const validated = await validateRow(merged);
          validated.recropPass = true;
          validated.reviewFlags = [...validated.reviewFlags, `코드 절단 교정: ${prev.drugCode} → ${code}(검출 9자리)`];
          out[truncIdx] = validated;
          continue;
        }
        // ② 좌표 기반 동일-물리-행 판정 (근본 중복 방어) — 문자열이 안 맞아도(코드 전치/오독)
        //    검출 위치가 기존 행과 같은 물리 행이면 신규 추가하지 않고 그 행을 보강한다.
        //    좌표만으로는 진짜 누락 행을 삼킬 위험이 있어 값 정합(금액/단가/수량 중 하나 일치)을 함께 요구.
        const orphanBox = boxByCode.get(code);
        const physIdx = orphanBox ? locatePhysicalRow(out, anchorBand, orphanBox) : -1;
        if (physIdx !== -1) {
          const prev = out[physIdx];
          const valAgrees =
            (rc.totalAmount != null && prev.totalAmount === rc.totalAmount) ||
            (rc.unitPrice != null && prev.unitPrice === rc.unitPrice) ||
            (rc.quantity != null && prev.quantity === rc.quantity);
          if (valAgrees) {
            const merged: MappedRow = { ...prev };
            const NUM = ["quantity", "days", "prescribedQty", "unitPrice", "totalAmount"] as const;
            for (const f of NUM) if (merged[f] == null && rc[f] != null) merged[f] = rc[f];

            // 정본 코드 선택: 같은 물리 행의 두 코드 표현 중 마스터로 검증되는(그 행 단가와 정합)
            // 코드를 채택. 코드 오독이 우연히 실재하는 딴 약 코드에 착지하는 경우(예: 073001410=
            // 리플록신, 화면엔 아토젯 073100410)를 방지한다. 검증 신호가 한쪽으로만 갈릴 때만 교체,
            // 애매(둘 다/둘 다 아님)하면 1차 유지. physIdx 기준이라 처리 순서와 무관하게 idempotent.
            const rowPrice = merged.unitPrice;
            const detectValid = await codeValidatesByMaster(code, rowPrice);
            const prevValid = await codeValidatesByMaster(prev.drugCode, rowPrice);
            let note: string | null = null;
            if (pickValidatedCode(prev.drugCode, code, prevValid, detectValid) === "detect") {
              // 약품코드를 바꾸는 개입 → 신원이 달라지므로 사용자가 원본과 대조하도록 표시(YELLOW).
              const rec = await lookupDrug(code).catch(() => null);
              const from = merged.drugCode;
              merged.drugCode = code;
              if (rec?.drugName) merged.drugName = rec.drugName;
              if (rec?.manufacturer) merged.manufacturer = rec.manufacturer;
              merged.reassigned = true;
              note = `약품코드 정정(${from} → ${code}${rec?.drugName ? `, ${rec.drugName}` : ""}) — 인식된 코드가 단가와 맞지 않아 단가가 일치하는 코드로 바꿨습니다. 원본과 대조해 주세요`;
            }
            // 순수 중복 제거(코드 변경 없음): 두 판독이 일치 → 조용히 병합, 별도 표시·플래그 없음.
            const validated = await validateRow(merged);
            validated.recropPass = true;
            if (note && !validated.reviewFlags.includes(note)) {
              validated.reviewFlags = [...validated.reviewFlags, note];
            }
            out[physIdx] = validated;
            continue;
          }
        }
        // ③ 진짜 누락 행 → 신규 행 후보
        const filled: MappedRow = {
          rowIndex: out.length,
          drugCode: code,
          drugName: null,
          manufacturer: null,
          quantity: rc.quantity,
          days: rc.days,
          prescribedQty: rc.prescribedQty,
          unitPrice: rc.unitPrice,
          totalAmount: rc.totalAmount,
          raw: { recrop: JSON.stringify(r) },
          reassigned: false,
        };
        const validated = await validateRow(filled);
        validated.recropPass = true;
        // 수량+총금액이 모두 일치하는 기존 행이 있으면 동일 라인의 다른 코드표현
        // (예: 내부코드로 이미 추출됨) → 중복 추가하지 않는다(안전망).
        const twin = out.find(
          (x) =>
            x.drugCode !== code &&
            x.quantity != null &&
            x.totalAmount != null &&
            x.quantity === validated.quantity &&
            x.totalAmount === validated.totalAmount,
        );
        if (!twin) out.push(validated);
      }
  }

  return out;
}

/**
 * 코드가 마스터로 "검증"되는가 — 그 행 단가와 마스터(현재가/이력)가 정합(current|historical)이면 true.
 * 코드·단가가 없으면 false. 값을 바꾸지 않는 순수 판정(matchDrugPrice 는 검증 전용).
 */
async function codeValidatesByMaster(
  code: string | null | undefined,
  unitPrice: number | null | undefined,
): Promise<boolean> {
  if (!code || unitPrice == null) return false;
  const m = await matchDrugPrice(code, unitPrice).catch(() => null);
  return m != null && (m.status === "current" || m.status === "historical");
}

/**
 * 같은 물리 행의 두 코드 표현 중 정본을 고른다(순수 판정).
 * detect 코드가 마스터로 검증되고 1차 코드는 아닐 때만 detect 채택. 그 외(둘 다/둘 다 아님/동일)는
 * 1차 유지 → 검증 신호가 명확히 갈릴 때만 개입하므로 순서와 무관하게 안정(idempotent).
 */
export function pickValidatedCode(
  prevCode: string | null | undefined,
  detectCode: string,
  prevValid: boolean,
  detectValid: boolean,
): "prev" | "detect" {
  if (detectValid && !prevValid && prevCode !== detectCode) return "detect";
  return "prev";
}

/** 정규화 box [y1,x1,y2,x2] 의 세로 중심. */
const yCenterOf = (b: [number, number, number, number]) => (b[0] + b[2]) / 2;

/** 두 box 의 세로 겹침 비율 (교집합 / 더 작은 높이). 1 에 가까울수록 같은 행. */
function yOverlapRatio(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const minH = Math.min(a[2] - a[0], b[2] - b[0]);
  return minH > 0 ? inter / minH : 0;
}

/**
 * orphan 검출 코드가 물리적으로 귀속되는 기존 행의 out 인덱스를 찾는다(없으면 -1).
 *  1) 직접 겹침: 어떤 앵커 행과 세로로 크게(>0.5) 겹치면 그 행.
 *  2) 갭 보간: orphan 세로 중심을 감싸는 위/아래 앵커 사이의 out 인덱스 구간에서
 *     '앵커가 없는(=코드 오독된)' 코드 행이 정확히 1개면 그 행. (전치 오독 케이스가 여기 해당)
 * 후보가 0개거나 2개 이상이면 모호 → -1(신규행 경로로 위임).
 */
export function locatePhysicalRow(
  out: MappedRow[],
  anchorBand: Map<number, [number, number, number, number]>,
  orphanBox: [number, number, number, number],
): number {
  let best = -1;
  let bestOv = 0.5;
  for (const [idx, box] of anchorBand) {
    const ov = yOverlapRatio(orphanBox, box);
    if (ov > bestOv) {
      bestOv = ov;
      best = idx;
    }
  }
  if (best !== -1) return best;

  const oc = yCenterOf(orphanBox);
  let loIdx = -1;
  let hiIdx = out.length;
  for (const [idx, box] of anchorBand) {
    const c = yCenterOf(box);
    if (c < oc) loIdx = Math.max(loIdx, idx);
    else if (c > oc) hiIdx = Math.min(hiIdx, idx);
  }
  const gap: number[] = [];
  for (let i = loIdx + 1; i < hiIdx; i++) {
    if (i >= 0 && i < out.length && !anchorBand.has(i) && out[i]?.drugCode) gap.push(i);
  }
  return gap.length === 1 ? gap[0] : -1;
}

/** 코드 box(정규화) 기준 가로 밴드(표 폭 전체)를 잘라 PNG 버퍼 반환. */
async function cropBand(
  buffer: Buffer,
  box: [number, number, number, number],
  W: number,
  H: number,
): Promise<Buffer | null> {
  const px = toPixelBox(box, W, H);
  const codeH = Math.max(px.height, Math.round(H * 0.01));
  const padY = Math.round(codeH * 1.6); // 위아래 여유로 같은 행의 다른 컬럼 포함
  const top = Math.max(0, px.y - padY);
  const bottom = Math.min(H, px.y + px.height + padY);
  const bandH = bottom - top;
  if (bandH <= 0) return null;
  try {
    return await sharp(buffer, { failOn: "none" })
      .extract({ left: 0, top, width: W, height: bandH })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * 라벨 없는 합계행 판별 — 코드가 없고, 그 행의 총금액(또는 총처방량)이
 * 코드가 있는 나머지 행들의 합과 ≈일치(±1%)하면 합계행으로 본다.
 * (Gemini 가 "합계" 텍스트 없이 열 합계만 담은 행을 내놓는 실제 사례 대응)
 */
function isTotalsRow(row: MappedRow, all: MappedRow[]): boolean {
  if (row.drugCode) return false;
  const coded = all.filter((r) => r !== row && r.drugCode);
  if (coded.length < 2) return false;
  const near = (v: number | null, sum: number) =>
    v !== null && sum > 0 && Math.abs(v - sum) <= Math.max(1, sum * 0.01);
  const sumAmt = coded.reduce((s, r) => s + (r.totalAmount ?? 0), 0);
  const sumQty = coded.reduce((s, r) => s + (r.prescribedQty ?? r.quantity ?? 0), 0);
  return near(row.totalAmount, sumAmt) || near(row.prescribedQty, sumQty);
}

function numOr(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function stageCost(stage: string, gen: { model: string; usage: { calls: number; tokensIn: number; tokensOut: number; latencyMs: number }; costUsd: number; costKrw: number }): StageCost {
  return {
    stage,
    model: gen.model,
    calls: gen.usage.calls,
    tokensIn: gen.usage.tokensIn,
    tokensOut: gen.usage.tokensOut,
    costUsd: gen.costUsd,
    costKrw: gen.costKrw,
    latencyMs: gen.usage.latencyMs,
  };
}

export { computeCost };
