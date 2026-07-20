import { prisma } from "@platform/db";
import type { ExtractResult } from "./extract.js";

/**
 * 추출 결과 영속화 — EdiExtraction/EdiExtractionRow + 단계별 UsageCost(원가).
 * best-effort: 저장 실패가 응답을 막지 않도록 caller 에서 감싼다.
 */

export interface PersistContext {
  requestId: string;
  userId: string;
  productId: string;
  jobItemId?: string | null;
  sourceImageUrl?: string | null;
  croppedImageUrl?: string | null;
  /** 크롭 실패 원본 데이터셋 객체 키/미리보기 URL (storeFailedCrop 결과). */
  datasetKey?: string | null;
  datasetUrl?: string | null;
  /** 벤치마크 실행 태그(있으면 UsageCost.benchRun 에 기록). */
  benchRun?: string | null;
}

/** 추출 결과를 DB 에 저장하고 생성된 EdiExtraction id 를 반환. */
export async function persistExtraction(
  result: ExtractResult,
  ctx: PersistContext,
): Promise<string> {
  const extraction = await prisma.ediExtraction.create({
    data: {
      userId: ctx.userId,
      productId: ctx.productId,
      requestId: ctx.requestId,
      sourceImageUrl: ctx.sourceImageUrl ?? null,
      croppedImageUrl: ctx.croppedImageUrl ?? null,
      datasetKey: ctx.datasetKey ?? null,
      datasetUrl: ctx.datasetUrl ?? null,
      cropMeta: result.cropMeta as any,
      templateId: result.template.id,
      templateKey: result.template.key,
      templateVersion: result.template.version,
      foundTable: result.foundTable,
      documentType: result.documentType,
      imageQuality: result.imageQuality as any,
      columnsRaw: result.columnsRaw as any,
      status: "done",
      rows: {
        create: result.rows.map((r) => ({
          rowIndex: r.rowIndex,
          drugCode: r.drugCode,
          drugName: r.drugName,
          manufacturer: r.manufacturer,
          quantity: r.quantity,
          days: r.days,
          prescribedQty: r.prescribedQty,
          unitPrice: r.unitPrice,
          totalAmount: r.totalAmount,
          raw: r.raw as any,
          codeValid: r.codeValid,
          codeType: r.codeType,
          mathValid: r.mathValid,
          priceValid: r.priceValid,
          priceStatus: r.priceStatus,
          confidence: r.confidence,
          trafficLight: r.trafficLight,
          needsReview: r.needsReview,
          reviewFlags: (r.reviewFlags ?? []) as any,
          recropPass: r.recropPass ?? false,
        })),
      },
    },
  });

  await persistCosts(result, ctx);
  // 마스터 미조회 코드 로깅 (dedup) — best-effort
  await logUnresolvedCodes(result, ctx.requestId).catch((e) =>
    console.warn("unresolved_code_log_failed:", e instanceof Error ? e.message : e),
  );
  return extraction.id;
}

/**
 * 마스터에 없거나 형식 비표준인 약가코드를 UnresolvedDrugCode 에 dedup 로깅.
 * drugCode 단위로 중복 제거 — 최초 관측 시 생성, 재관측 시 count 증가·lastSeenAt 갱신.
 * 한 추출 안에서 같은 코드가 여러 행에 있어도 1회만 카운트한다.
 */
export async function logUnresolvedCodes(result: ExtractResult, requestId: string): Promise<void> {
  const seen = new Map<string, { codeType: string; drugName: string | null }>();
  for (const r of result.rows) {
    if (r.drugCode && !r.codeValid) {
      if (!seen.has(r.drugCode)) seen.set(r.drugCode, { codeType: r.codeType, drugName: r.drugName ?? null });
    }
  }
  if (seen.size === 0) return;
  const now = new Date();
  for (const [drugCode, info] of seen) {
    await prisma.unresolvedDrugCode
      .upsert({
        where: { drugCode },
        create: { drugCode, codeType: info.codeType, drugName: info.drugName, sampleRequestId: requestId, count: 1 },
        update: {
          count: { increment: 1 },
          lastSeenAt: now,
          sampleRequestId: requestId,
          codeType: info.codeType,
          ...(info.drugName ? { drugName: info.drugName } : {}),
        },
      })
      .catch(() => {});
  }
}

/** 단계별 원가 적재 (UsageCost). */
export async function persistCosts(result: ExtractResult, ctx: PersistContext): Promise<void> {
  if (!result.costs.length) return;
  await prisma.usageCost.createMany({
    data: result.costs.map((c) => ({
      requestId: ctx.requestId,
      jobItemId: ctx.jobItemId ?? null,
      userId: ctx.userId,
      productId: ctx.productId,
      stage: c.stage,
      model: c.model,
      templateId: result.template.id,
      calls: c.calls,
      tokensIn: c.tokensIn,
      tokensOut: c.tokensOut,
      costUsd: c.costUsd,
      costKrw: c.costKrw,
      latencyMs: c.latencyMs,
      benchRun: ctx.benchRun ?? null,
    })),
  });
}

/**
 * 외부 API/데모 응답 뷰 — 핵심(items)만 최상위, 진단은 meta 로 분리해 단순화.
 * items 의 값은 OCR 로 읽은 정본. 코드가 비표준이어도 약품명·숫자는 제공(needsReview 로 표시).
 */
export function toApiView(result: ExtractResult) {
  return {
    documentType: result.documentType, // drug_table 이면 정상, 아니면 표 없음 사유
    foundTable: result.foundTable,
    items: result.rows.map((r) => ({
      drugCode: r.drugCode, // 보이는 그대로(9자리 아닐 수 있음)
      drugName: r.drugName,
      quantity: r.quantity,
      days: r.days,
      prescribedQty: r.prescribedQty,
      unitPrice: r.unitPrice,
      totalAmount: r.totalAmount,
      codeInMaster: r.codeValid, // 마스터 조회 여부
      priceCheck: r.priceStatus, // current | historical | mismatch | none
      status: r.trafficLight, // GREEN(정상) | YELLOW(확인권장) | RED(오류/확인필요)
      needsReview: r.needsReview,
      review: r.reviewFlags, // 확인 사유
    })),
    summary: {
      items: result.rows.length,
      needsReview: result.rows.filter((r) => r.needsReview).length,
      byStatus: result.tallies, // { green, yellow, red }
      completeExtraction: result.completeness.complete, // 합계 대조로 본 전체표 추출 여부
    },
    // 진단(참고용) — 외부 처리에 불필요하면 무시 가능
    meta: {
      imageReadable: result.imageQuality.readable,
      imageIssues: result.imageQuality.issues,
      rotationApplied: result.appliedRotation,
      cropped: !result.cropMeta.fallback,
      droppedSummaryRows: result.summaryRowCount,
      template: result.template,
    },
  };
}
