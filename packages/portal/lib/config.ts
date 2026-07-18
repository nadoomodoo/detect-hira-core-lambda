// API 게이트웨이 base URL — 환경별 (로컬=localhost, 운영=marketapi.nadoo.ai)
export const API_BASE = process.env.API_BASE_URL ?? "https://marketapi.nadoo.ai";

// 사이트 브랜드
export const BRAND = "나두AI";
export const SITE_TAGLINE = "나두AI API 마켓플레이스";

import type { ApiKind } from "@platform/db";

/** API 종류(SSOT) → 대표 엔드포인트 경로 세그먼트. */
export function endpointPath(kind: ApiKind): string {
  return kind === "EXTRACT" ? "extract" : "detect";
}
/** API 종류가 추출 계열인지 — 문서/데모/응답 분기용. */
export function isExtractKind(kind: ApiKind): boolean {
  return kind === "EXTRACT";
}
