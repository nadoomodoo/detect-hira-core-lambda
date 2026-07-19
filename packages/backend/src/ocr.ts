import { GoogleGenAI, Type } from "@google/genai";
import type { DetectedCode } from "./types.js";

/**
 * Vertex AI Gemini(신 SDK @google/genai)로 이미지에서 HIRA 약가코드(9자리)를 검출한다.
 *
 * - @google-cloud/vertexai(2026-06-24 지원종료)에서 @google/genai 로 이전.
 * - vertexai:true + project/location 로 Vertex 백엔드 사용, global 리전 정식 지원.
 * - structured output (responseSchema) 로 각 항목이 { code, box_2d:[y1,x1,y2,x2] } 형태가 되도록 강제.
 * - box 좌표는 0~1000 정규화 좌표 (Gemini 표준 bounding box 규약).
 */

const DEFAULT_MODEL = "gemini-3.1-flash-lite";

/** 반복 루프(degeneration)일 때만 쓰는 에스컬레이션 모델. */
const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash";

type Contents = { role: string; parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> }[];
type GenConfig = Record<string, unknown>;

// ============================================================
// 사용량 집계 — 호출 수 / 토큰 / 지연시간 (용도·모델별)
// ============================================================

/** 용도·모델별 누적 사용량. */
export interface ModelUsage {
  /** 성공한 호출 수. */
  calls: number;
  /** 백오프로 재시도된 실패 시도 수. */
  transientErrors: number;
  /** 입력(프롬프트+이미지) 토큰 합. */
  promptTokens: number;
  /** 출력(응답) 토큰 합. */
  outputTokens: number;
  /** 총 토큰 합 (usageMetadata.totalTokenCount). */
  totalTokens: number;
  /** 성공 호출들의 지연시간 합 (ms). */
  latencyMs: number;
}

const usageByKey = new Map<string, ModelUsage>();

function usageBucket(key: string): ModelUsage {
  let u = usageByKey.get(key);
  if (!u) {
    u = { calls: 0, transientErrors: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0 };
    usageByKey.set(key, u);
  }
  return u;
}

/** 누적 사용량 스냅샷 (용도·모델별 + 합계). */
export function getUsageStats(): { byKey: Record<string, ModelUsage>; total: ModelUsage } {
  const sum: ModelUsage = { calls: 0, transientErrors: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0 };
  const byKey: Record<string, ModelUsage> = {};
  for (const [k, u] of usageByKey) {
    byKey[k] = { ...u };
    sum.calls += u.calls;
    sum.transientErrors += u.transientErrors;
    sum.promptTokens += u.promptTokens;
    sum.outputTokens += u.outputTokens;
    sum.totalTokens += u.totalTokens;
    sum.latencyMs += u.latencyMs;
  }
  return { byKey, total: sum };
}

/** 사용량 집계 리셋. */
export function resetUsageStats(): void {
  usageByKey.clear();
}

/** 사용량 집계를 사람이 읽을 요약 문자열로 포맷. */
export function formatUsageStats(): string {
  const { byKey, total } = getUsageStats();
  const lines = Object.entries(byKey).map(([k, u]) => {
    const avg = u.calls > 0 ? Math.round(u.latencyMs / u.calls) : 0;
    return `  ${k}: 호출 ${u.calls}회` +
      (u.transientErrors > 0 ? ` (일시오류 재시도 ${u.transientErrors})` : "") +
      ` | 평균 ${avg}ms | 입력 ${u.promptTokens.toLocaleString()} / 출력 ${u.outputTokens.toLocaleString()} 토큰`;
  });
  const avgTotal = total.calls > 0 ? Math.round(total.latencyMs / total.calls) : 0;
  return [
    "Gemini 사용량 집계:",
    ...lines,
    `  합계: 호출 ${total.calls}회 | 평균 ${avgTotal}ms | 총 ${total.totalTokens.toLocaleString()} 토큰 (입력 ${total.promptTokens.toLocaleString()} / 출력 ${total.outputTokens.toLocaleString()})`,
  ].join("\n");
}

/**
 * Vertex AI 인증 설정.
 * - vertex.txt 방식: GOOGLE_APPLICATION_CREDENTIALS_JSON (서비스 계정 JSON 문자열)
 *   또는 VERTEX_API_KEY (Express mode API 키)
 * - 표준 방식: GOOGLE_APPLICATION_CREDENTIALS (키 파일 경로) / ADC
 */
/** 서비스계정 JSON(문자열) 자격증명. 없으면 ADC. */
function resolveCredentials(): Record<string, unknown> | undefined {
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsJson) return undefined; // ADC (GOOGLE_APPLICATION_CREDENTIALS / gcloud)
  try {
    return JSON.parse(credsJson);
  } catch {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON 파싱 실패. 올바른 JSON 인지 확인.");
  }
}

/** Vertex 백엔드 GoogleGenAI 클라이언트 (프로젝트/리전당 1개, 캐싱). */
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (aiClient) return aiClient;
  const project = process.env.VERTEX_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.VERTEX_LOCATION ?? process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  if (!project) {
    throw new Error("VERTEX_PROJECT_ID (또는 GOOGLE_CLOUD_PROJECT) 환경변수가 필요합니다. .env.example 참고.");
  }
  const credentials = resolveCredentials();
  aiClient = new GoogleGenAI({
    vertexai: true,
    project,
    location, // 신 SDK는 global 정식 지원 (구 SDK 엔드포인트 우회 불필요)
    ...(credentials ? { googleAuthOptions: { credentials } } : {}),
  });
  return aiClient;
}

/** 모델명 해석 (지정 없으면 환경변수/기본 모델). */
export function resolveModel(modelName?: string): string {
  return modelName ?? process.env.MODEL_NAME ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
}

/** 캐시된 Vertex GoogleGenAI 클라이언트 접근자 (gemini.ts 등 재사용용). */
export function genAIClient(): GoogleGenAI {
  return getAI();
}

/** Gemini 3 계열 — 샘플링 파라미터(temperature/topP/topK) deprecated(모델 자동). */
export function isGemini3(model: string): boolean {
  return /gemini-3/i.test(model);
}

/**
 * 공용 생성 튜닝(모델 인지형) — OCR/추출은 구조화 출력이라 사고(thinking)가 불필요.
 *  - temperature: 2.x 모델은 이 값을 실제로 쓰고, Gemini 3 는 deprecated(자동)지만 temp 0 은
 *    결정성에 유리하고 무해하므로 모든 모델에 유지(2.x·3.x 병행 운용). GEMINI_TEMPERATURE 로 조정.
 *  - thinking OFF(기본): 3.5-flash 등은 기본 thinking 이 켜져 출력토큰(=사고토큰)·지연을 크게 늘림.
 *    GEMINI_THINKING_BUDGET 정수(기본 0=off). "auto" 면 필드 미전송(모델 기본).
 *  - maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS 설정 시에만 전송(미설정=큰 표 잘림 방지).
 *  - seed: GEMINI_SEED 설정 시 재현성 향상(비결정성 완화, 보장은 아님).
 */
export function tuningConfig(model: string, temperature?: number): Record<string, unknown> {
  const envTemp = Number(process.env.GEMINI_TEMPERATURE);
  const out: Record<string, unknown> = {
    temperature: temperature ?? (Number.isFinite(envTemp) ? envTemp : 0),
  };
  void model; // 현재는 모델 무관하게 temperature 유지(2.x·3.x 병행). 필요 시 모델별 분기 가능.
  const tb = process.env.GEMINI_THINKING_BUDGET;
  if (tb !== "auto") {
    const budget = tb === undefined || tb === "" ? 0 : Number(tb);
    if (Number.isFinite(budget)) out.thinkingConfig = { thinkingBudget: budget };
  }
  const mot = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(mot) && mot > 0) out.maxOutputTokens = mot;
  const seed = Number(process.env.GEMINI_SEED);
  if (process.env.GEMINI_SEED !== undefined && Number.isFinite(seed)) out.seed = seed;
  return out;
}

/** 프로미스 타임아웃 — 초과 시 reject(멈춘 호출이 워커를 무한 점유하지 않게). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Gemini 호출 타임아웃(${ms}ms)`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const RETRYABLE_NAMES = /RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|ABORTED|타임아웃|timeout|ECONN|ETIMEDOUT|socket|network|fetch failed/i;
const PERMANENT_NAMES = /INVALID_ARGUMENT|PERMISSION_DENIED|UNAUTHENTICATED|NOT_FOUND|FAILED_PRECONDITION/i;

/** HTTP/상태 코드 추출(SDK 오류 형태가 다양해 방어적으로 조회). */
function errStatus(err: any): number | undefined {
  const s = err?.status ?? err?.code ?? err?.response?.status ?? err?.cause?.status;
  return typeof s === "number" ? s : undefined;
}

/**
 * Gemini 오류 재시도 판정(Vertex/Gemini API 오류 규약).
 *  - 재시도: 429(RESOURCE_EXHAUSTED)·5xx(INTERNAL/UNAVAILABLE/DEADLINE)·네트워크·타임아웃
 *  - 영구실패(즉시 중단): 400(INVALID_ARGUMENT)·401·403(PERMISSION_DENIED)·404(NOT_FOUND, 모델 리전없음 등)
 */
export function isRetryableGeminiError(err: any): boolean {
  const s = errStatus(err);
  if (typeof s === "number") {
    if (s === 429 || s >= 500) return true;
    if (s >= 400) return false;
  }
  const msg = String(err?.message ?? err ?? "");
  if (PERMANENT_NAMES.test(msg)) return false;
  if (RETRYABLE_NAMES.test(msg)) return true;
  return true; // 불명(네트워크/일시장애 추정) → 재시도
}

/** OCR 응답 스키마 — code + box_2d([ymin,xmin,ymax,xmax] 0~1000). temperature/thinking 은 callModel 이 모델별로 주입. */
const OCR_CONFIG: GenConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        code: { type: Type.STRING, description: "9자리 HIRA 약가코드 (숫자만)" },
        // Gemini 학습 표준 bbox 필드명(box_2d) 유지 — 좌표 정확도 보존.
        box_2d: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER },
          description: "bounding box [ymin, xmin, ymax, xmax], 각 값은 0~1000 정규화 좌표",
        },
      },
      required: ["code", "box_2d"],
    },
  },
};

const OCR_PROMPT = `이 이미지에서 HIRA 약가코드(정확히 9자리로 이어진 숫자)를 모두 찾으세요.
- 각 코드와 해당 코드가 위치한 영역의 bounding box(box_2d) 를 반환.
- box_2d 는 [ymin, xmin, ymax, xmax] 순서이며, 각 값은 0~1000 정규화 좌표이다.
- box_2d 는 9자리 숫자 텍스트만 딱 맞게(tight) 감싸야 한다. 표의 다른 셀이나 옆/위/아래 행을 포함하지 말 것.
- 같은 코드가 이미지에 여러 번 보이면(예: 등록코드/청구코드 두 컬럼에 같은 코드), 보이는 모든 위치를 각각 별도 항목으로 반환한다.
- 같은 표 안에 코드가 여러 행 반복되면, 각 box 의 세로 위치가 해당 행의 숫자와 정확히 일치해야 한다.
- 9자리가 아닌 숫자는 제외. 잘린 코드라도 보이는 전체를 시도할 것.
- 이미지에 실제로 보이는 숫자만 반환하고, 보이지 않는 코드를 추측해 만들지 말 것.
- 결과는 JSON 배열만 반환한다.`;

/** 이미지 버퍼(및 MIME)에서 약가코드를 검출. */
export async function detectHiraCodes(
  imageBuffer: Buffer,
  mimeType: string = "image/png",
): Promise<DetectedCode[]> {
  const model = resolveModel();
  const contents: Contents = [{
    role: "user",
    parts: [{ inlineData: { data: imageBuffer.toString("base64"), mimeType } }, { text: OCR_PROMPT }],
  }];

  const text = await callModel(model, contents, OCR_CONFIG, "ocr");

  let dets = mergeNearDuplicates(parseOcrResponse(text));

  // 반복 루프(degeneration) 방어: 한 코드는 문서에서 보통 1~2회(등록/청구 컬럼) 등장.
  // 검출 수가 유니크 코드 수의 2.5배를 크게 넘으면 모델이 같은 코드를
  // 엉뚱한 좌표로 반복 생성한 것. 간헐적 현상이므로 정상 응답이 나올 때까지
  // 최대 2회 재시도하고, 전부 이상하면 그중 검출 수가 가장 적은 응답을 채택.
  for (let attempt = 0; isDegenerate(dets) && attempt < 2; attempt++) {
    const retry = mergeNearDuplicates(parseOcrResponse(await callModel(model, contents, OCR_CONFIG, "ocr-retry")));
    if (retry.length === 0) continue;
    if (!isDegenerate(retry)) {
      dets = retry;
      break;
    }
    if (retry.length < dets.length) dets = retry;
  }

  // 재시도로도 해소 안 되면 상위 모델(기본 gemini-3.5-flash)로 1회 에스컬레이션.
  // 평상시(정상 응답)에는 MODEL_NAME 모델만 사용 — 반복 루프일 때만 폴백이 개입.
  // 폴백 모델이 리전 미제공(404) 등으로 실패해도 기존 결과를 버리지 않는다.
  if (isDegenerate(dets)) {
    try {
      const fallback = resolveModel(process.env.OCR_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL);
      const fbDets = mergeNearDuplicates(parseOcrResponse(await callModel(fallback, contents, OCR_CONFIG, "ocr-fallback")));
      if (fbDets.length > 0 && (!isDegenerate(fbDets) || fbDets.length < dets.length)) {
        dets = fbDets;
      }
    } catch {
      // 에스컬레이션 실패 → 재시도까지 반영된 기존 dets 유지
    }
  }

  return dets;
}

/** 반복 루프 의심 여부 — 검출 수가 유니크 코드 수 대비 비정상적으로 많음. */
function isDegenerate(dets: DetectedCode[]): boolean {
  if (dets.length < 30) return false;
  const unique = new Set(dets.map((d) => d.code)).size;
  return dets.length > unique * 2.5;
}

/** 두 박스([y1,x1,y2,x2] 정규화 좌표)의 IoU. */
function boxIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const iy = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const ix = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = iy * ix;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/** 같은 코드가 거의 같은 위치(IoU>0.5)에 반복 검출된 경우 첫 항목만 유지. */
function mergeNearDuplicates(dets: DetectedCode[]): DetectedCode[] {
  const out: DetectedCode[] = [];
  for (const d of dets) {
    const dup = out.some((o) => o.code === d.code && boxIoU(o.box, d.box) > 0.5);
    if (!dup) out.push(d);
  }
  return out;
}

/**
 * 모델 호출 + 일시 오류(네트워크/쿼터) 지수 백오프 재시도.
 * 배치 병렬 실행 시 "exception posting request to model" 류의
 * 일시적 실패가 발생하므로 최대 3회 재시도한다.
 * 호출 수/토큰/지연시간을 용도·모델별로 집계한다 (purpose 라벨).
 */
async function callModel(
  model: string,
  contents: Contents,
  config: GenConfig,
  purpose: string = "ocr",
): Promise<string> {
  const usage = usageBucket(`${purpose}(${model})`);
  const timeoutMs = Number(process.env.EXTRACT_TIMEOUT_MS ?? 60000);
  // 모델별 튜닝(temperature/thinking off/maxOutputTokens/seed)을 스키마 config 에 병합.
  const finalConfig = { ...config, ...tuningConfig(model) };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const resp = await withTimeout(
        getAI().models.generateContent({ model, contents: contents as any, config: finalConfig as any }),
        timeoutMs,
      );
      usage.calls += 1;
      usage.latencyMs += Date.now() - started;
      const meta = resp.usageMetadata;
      usage.promptTokens += meta?.promptTokenCount ?? 0;
      usage.outputTokens += meta?.candidatesTokenCount ?? 0;
      usage.totalTokens += meta?.totalTokenCount ?? 0;
      return resp.text ?? extractText(resp);
    } catch (err) {
      lastErr = err;
      usage.transientErrors += 1;
      // 영구 오류(4xx: 잘못된 요청·권한·모델없음)는 재시도 무의미 → 즉시 중단.
      if (attempt < 3 && isRetryableGeminiError(err)) {
        const delay = 1500 * 2 ** attempt + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        break;
      }
    }
  }
  throw lastErr;
}

/** 응답에서 텍스트 부분을 모두 이어붙여 반환 (resp.text 폴백용). */
function extractText(resp: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }): string {
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
}

/**
 * Gemini 응답(JSON 문자열) 을 DetectedCode[] 로 파싱.
 * 응답이 비정상적일 때도 최대한 복구 시도.
 */
export function parseOcrResponse(raw: string): DetectedCode[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // 모델이 JSON 외 텍스트를 섞어 반환하는 경우, 첫 [ ~ 마지막 ] 까지 추출 시도
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  }

  if (!Array.isArray(parsed)) return [];

  const out: DetectedCode[] = [];
  const seen = new Set<string>(); // 동일 (code, box) 중복 제거 — 반투명 채움 중첩 방지
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const code = String(rec.code ?? "").trim();
    const box = rec.box_2d ?? rec.box; // box_2d 우선, 구버전 box 폴백
    if (!/^\d{9}$/.test(code)) continue; // 9자리 숫자만
    if (!Array.isArray(box) || box.length !== 4) continue;
    const nums = box.map(Number);
    if (nums.some((n) => Number.isNaN(n))) continue;
    // 0~1000 범위로 클램프
    const clamped = nums.map((n) => Math.max(0, Math.min(1000, n))) as [
      number,
      number,
      number,
      number,
    ];
    const key = `${code}:${clamped.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code, box: clamped });
  }
  return out;
}

/** 테스트/재사용을 위해 캐시된 클라이언트를 리셋. */
export function resetOcrClient(): void {
  aiClient = null;
}

// ============================================================
// 회전 감지 — Gemini 에게 4-way 각도만 질의 (EXIF 무시)
// ============================================================

/** 회전 감지 결과. */
export interface RotationResult {
  /** 감지된 회전 각도 (0, 90, 180, 270 중 하나). 정방향 기준 시계방향. */
  rotation: number;
  /** confidence (0~1). minRotationScore 미만이면 0 으로 취급. */
  confidence: number;
}

/** confidence 가 이 값 미만이면 회전 미적용 (오판 방지). */
const DEFAULT_MIN_ROTATION_SCORE = 0.6;

/** 회전 감지 응답 스키마 (enum 4값만). temperature/thinking 은 callModel 이 모델별로 주입. */
const ROTATION_CONFIG: GenConfig = {
  responseMimeType: "application/json",
  responseSchema: {
    type: Type.OBJECT,
    properties: {
      rotation: {
        type: Type.STRING,
        enum: ["0", "90", "180", "270"],
        description: "이미지가 정방향(위가 위) 기준으로 시계방향으로 몇 도 회전했는지. 0=정방향.",
      },
    },
    required: ["rotation"],
  },
};

const ROTATION_PROMPT = `이 이미지는 문서/처방전이다. 이미지가 바르게 보이려면(글자가 바로 읽히려면) 시계방향으로 몇 도 회전해야 하는가?
- 휴대폰 촬영 이미지는 종종 90/180/270도 회전되어 있다.
- EXIF 메타데이터는 무시하고, 픽셀에 보이는 텍스트 방향으로 판단하라.
- 정답은 0, 90, 180, 270 중 하나이다. 0이면 이미 정방향.`;

/**
 * 이미지의 회전 각도를 Gemini 에게 질의.
 * - EXIF 무식, 픽셀 기반 판별.
 * - confidence 가 낮으면 rotation=0 으로 반환 (안전장치).
 */
export async function detectRotation(
  imageBuffer: Buffer,
  mimeType: string = "image/jpeg",
): Promise<RotationResult> {
  const model = resolveModel(); // 회전 감지도 경량 기본 모델
  const contents: Contents = [{
    role: "user",
    parts: [{ inlineData: { data: imageBuffer.toString("base64"), mimeType } }, { text: ROTATION_PROMPT }],
  }];

  const text = await callModel(model, contents, ROTATION_CONFIG, "rotation");

  return parseRotationResponse(text);
}

/** 회전 응답 파싱. 비정상 응답 시 rotation=0 안전 폴백. */
export function parseRotationResponse(raw: string): RotationResult {
  const trimmed = raw.trim();
  if (!trimmed) return { rotation: 0, confidence: 0 };

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const rot = Number(parsed.rotation);
    // confidence 필드가 없을 수 있으므로 유추: 정상값이면 1.0, 아니면 0
    const conf = typeof parsed.confidence === "number"
      ? parsed.confidence
      : (rot === 0 ? 0.9 : 0.85); // 명시적 confidence 없으면 합리적 기본값

    if (![0, 90, 180, 270].includes(rot)) {
      return { rotation: 0, confidence: 0 };
    }
    return { rotation: rot, confidence: conf };
  } catch {
    // JSON 추출 시도
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1) return { rotation: 0, confidence: 0 };
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      const rot = Number(parsed.rotation);
      if (![0, 90, 180, 270].includes(rot)) {
        return { rotation: 0, confidence: 0 };
      }
      return { rotation: rot, confidence: 0.8 };
    } catch {
      return { rotation: 0, confidence: 0 };
    }
  }
}

/**
 * 회전 보정 필요 여부 판단 (confidence 기반 안전장치).
 * rotation=0 이거나 confidence 가 낮으면 false.
 */
export function shouldApplyRotation(
  result: RotationResult,
  minScore: number = DEFAULT_MIN_ROTATION_SCORE,
): boolean {
  return result.rotation !== 0 && result.confidence >= minScore;
}

/** 캐시된 클라이언트 리셋. */
export function resetAllClients(): void {
  aiClient = null;
}

