/**
 * 모델 단가표 — Gemini 토큰 사용량 → 원가(USD/KRW) 환산.
 *
 * UsageCost(원가 추적) 및 벤치마크(§9)에서 사용. billing.ts(고객 과금=매출)와 분리 —
 * 마진 = 매출(CreditTx) − 원가(UsageCost).
 *
 * 단가는 1M(백만) 토큰당 USD 기준(Gemini 공식 표기 관례). 환율/단가는 env 로 덮어쓸 수 있다.
 * 정확한 정산이 필요하면 공식 단가로 PRICING 을 갱신할 것 — 여기 값은 원가 추적/비교용 근사.
 */

export interface ModelPrice {
  /** 입력 100만 토큰당 USD */
  inPerM: number;
  /** 출력 100만 토큰당 USD */
  outPerM: number;
}

/** USD→KRW 환율 (env PRICING_USD_KRW 로 덮어쓰기). */
export function usdKrwRate(): number {
  const v = Number(process.env.PRICING_USD_KRW);
  return Number.isFinite(v) && v > 0 ? v : 1400;
}

/**
 * 모델별 단가(1M 토큰당 USD) — 공식 단가 반영(2026-07).
 *  - Gemini 3.5 Flash: in $1.50 / out $9.00
 *  - Gemini 3 Flash(Preview): in $0.50 / out $3.00
 *  - Gemini 2.5 Flash-Lite: in $0.10 / out $0.40
 * lite 계열은 0.10/0.40, 비-lite flash 는 버전별로 위 값 적용.
 * 키는 prefix 매칭(가장 긴 prefix 우선) — lite 항목이 non-lite 보다 길어 우선 매칭된다.
 * (Context Caching $0.045~$1.00/1M/h 은 현재 미사용이라 미반영)
 */
const PRICING: Record<string, ModelPrice> = {
  // lite 계열 (모두 0.10 / 0.40)
  "gemini-3.5-flash-lite": { inPerM: 0.1, outPerM: 0.4 },
  "gemini-3.1-flash-lite": { inPerM: 0.1, outPerM: 0.4 },
  "gemini-3-flash-lite": { inPerM: 0.1, outPerM: 0.4 },
  "gemini-2.5-flash-lite": { inPerM: 0.1, outPerM: 0.4 },
  "gemini-2.0-flash-lite": { inPerM: 0.075, outPerM: 0.3 },
  // 비-lite flash
  "gemini-3.5-flash": { inPerM: 1.5, outPerM: 9.0 },
  "gemini-3.1-flash": { inPerM: 0.5, outPerM: 3.0 }, // 3.x Flash(Preview) 기준 근사
  "gemini-3-flash": { inPerM: 0.5, outPerM: 3.0 },
  "gemini-2.5-flash": { inPerM: 0.3, outPerM: 2.5 },
  "gemini-2.0-flash": { inPerM: 0.1, outPerM: 0.4 },
};

/** 미등록 모델 폴백 단가(보수적으로 3.5-flash 급). */
const DEFAULT_PRICE: ModelPrice = { inPerM: 1.5, outPerM: 9.0 };

/** 모델명 → 단가. 가장 긴 prefix 매칭. */
export function priceFor(model: string): ModelPrice {
  let best: ModelPrice | null = null;
  let bestLen = -1;
  for (const [key, price] of Object.entries(PRICING)) {
    if (model.startsWith(key) && key.length > bestLen) {
      best = price;
      bestLen = key.length;
    }
  }
  return best ?? DEFAULT_PRICE;
}

/** 지원(가격표 등록) 모델인지 — 사용자 지정 model 을 호출 전에 검증(미지 모델 400 차단). */
export function isKnownModel(model: string): boolean {
  const m = (model ?? "").trim();
  return m.length > 0 && Object.keys(PRICING).some((k) => m.startsWith(k));
}

/** 지원 모델 목록(오류 메시지·검증용). */
export function knownModels(): string[] {
  return Object.keys(PRICING);
}

export interface CostResult {
  costUsd: number;
  costKrw: number;
}

/** 토큰 사용량 → 원가(USD/KRW). */
export function computeCost(model: string, tokensIn: number, tokensOut: number): CostResult {
  const p = priceFor(model);
  const costUsd = (tokensIn / 1_000_000) * p.inPerM + (tokensOut / 1_000_000) * p.outPerM;
  const costKrw = costUsd * usdKrwRate();
  return { costUsd, costKrw };
}
