import { genAIClient, resolveModel, tuningConfig, withTimeout, isRetryableGeminiError } from "./ocr.js";
import { computeCost } from "./pricing.js";

/**
 * 범용 Gemini 호출 헬퍼 — 이미지+프롬프트+responseSchema 로 구조화 JSON 을 받고,
 * 호출별 토큰 사용량과 원가를 반환한다.
 *
 * ocr.ts 의 detectHiraCodes 는 전역 사용량 버킷에 집계하지만, 추출/벤치는
 * 요청·단계별 원가(UsageCost)를 남겨야 하므로 여기서는 호출별 usage 를 리턴한다.
 * 클라이언트는 ocr.ts 의 캐시된 Vertex 클라이언트를 재사용한다.
 */

export interface GeminiUsage {
  calls: number;
  transientErrors: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  latencyMs: number;
}

export interface GeminiCallResult {
  text: string;
  model: string;
  usage: GeminiUsage;
  costUsd: number;
  costKrw: number;
}

type Contents = {
  role: string;
  parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }>;
}[];

export interface GeminiGenOptions {
  model?: string;
  imageBuffer?: Buffer;
  mimeType?: string;
  prompt: string;
  responseSchema: unknown;
  temperature?: number;
  maxRetries?: number;
  /** 호출당 타임아웃(ms). 초과 시 재시도 가능한 오류로 처리. 기본 EXTRACT_TIMEOUT_MS 또는 60초. */
  timeoutMs?: number;
}

/** 응답 텍스트 폴백 추출. */
function extractText(resp: {
  text?: string;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}): string {
  if (typeof resp.text === "string" && resp.text) return resp.text;
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
}

/**
 * 구조화 JSON 생성 호출 (지수 백오프 재시도 포함).
 * 반환: 응답 텍스트 + 호출별 토큰/원가.
 */
export async function generateJson(opts: GeminiGenOptions): Promise<GeminiCallResult> {
  const model = resolveModel(opts.model);
  const mimeType = opts.mimeType ?? "image/jpeg";
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? Number(process.env.EXTRACT_TIMEOUT_MS ?? 60000);

  const parts: Contents[number]["parts"] = [];
  if (opts.imageBuffer) {
    parts.push({ inlineData: { data: opts.imageBuffer.toString("base64"), mimeType } });
  }
  parts.push({ text: opts.prompt });
  const contents: Contents = [{ role: "user", parts }];

  const tuned = tuningConfig(model, opts.temperature);
  const config: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseSchema: opts.responseSchema,
    // 모델별 튜닝: temperature(2.x·3.x 유지) + thinking off + maxOutputTokens/seed(env).
    ...tuned,
  };

  // 적응형 출력 상한 — 항목이 많아 응답이 잘리면(finishReason=MAX_TOKENS) 재시도 시 2배로 확대.
  const ceil = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS_CEIL ?? 65536);
  let maxTokens = typeof tuned.maxOutputTokens === "number" ? tuned.maxOutputTokens : 16384;

  const usage: GeminiUsage = {
    calls: 0,
    transientErrors: 0,
    tokensIn: 0,
    tokensOut: 0,
    totalTokens: 0,
    latencyMs: 0,
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const started = Date.now();
    try {
      const resp = await withTimeout(
        genAIClient().models.generateContent({
          model,
          contents: contents as any,
          config: { ...config, maxOutputTokens: maxTokens } as any,
        }),
        timeoutMs,
      );
      usage.calls += 1;
      usage.latencyMs += Date.now() - started;
      const meta = resp.usageMetadata;
      usage.tokensIn += meta?.promptTokenCount ?? 0;
      usage.tokensOut += meta?.candidatesTokenCount ?? 0;
      usage.totalTokens += meta?.totalTokenCount ?? 0;
      // 잘림 감지 → 더 큰 예산으로 재시도(항목 많은 표 대응). cap 은 실제 사용량과 무관.
      const finishReason = (resp as unknown as { candidates?: Array<{ finishReason?: string }> }).candidates?.[0]?.finishReason;
      if (finishReason === "MAX_TOKENS" && maxTokens < ceil && attempt < maxRetries) {
        maxTokens = Math.min(ceil, maxTokens * 2);
        usage.transientErrors += 1;
        continue;
      }
      const text = extractText(resp);
      const { costUsd, costKrw } = computeCost(model, usage.tokensIn, usage.tokensOut);
      return { text, model, usage, costUsd, costKrw };
    } catch (err) {
      lastErr = err;
      usage.transientErrors += 1;
      // 영구 오류(4xx: INVALID_ARGUMENT/PERMISSION_DENIED/NOT_FOUND)는 재시도 무의미 → 즉시 중단.
      if (attempt < maxRetries && isRetryableGeminiError(err)) {
        const delay = 1500 * 2 ** attempt + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        break;
      }
    }
  }
  throw lastErr;
}

/** JSON 텍스트를 안전 파싱 — 코드펜스/잡텍스트 섞여도 첫 객체/배열 복구. */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // ```json ... ``` 펜스 제거 후 재시도, 그다음 첫 { 또는 [ ~ 마지막 } 또는 ] 추출
    const noFence = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      return JSON.parse(noFence) as T;
    } catch {
      const objStart = noFence.indexOf("{");
      const objEnd = noFence.lastIndexOf("}");
      const arrStart = noFence.indexOf("[");
      const arrEnd = noFence.lastIndexOf("]");
      // 배열/객체 중 먼저 시작하는 것 채택
      const useArr = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
      const s = useArr ? arrStart : objStart;
      const e = useArr ? arrEnd : objEnd;
      if (s === -1 || e === -1 || e <= s) return null;
      try {
        return JSON.parse(noFence.slice(s, e + 1)) as T;
      } catch {
        return null;
      }
    }
  }
}
