/**
 * RT-DETR 표 크롭 사이드카(GCP Cloud Run Python) 클라이언트.
 *
 * 계약: POST {CROP_SERVICE_URL}/crop  body {image_b64, pad}
 *       → {cropped_b64, meta:{bbox,score,applied_rotation,fallback,orig_size,crop_size}}
 *
 * CROP_SERVICE_URL 미설정 또는 호출 실패 시 원본을 그대로 사용(fallback=true) —
 * 크롭 실패가 추출 전체를 막지 않도록 fail-open.
 */

export interface CropMeta {
  bbox?: number[];
  score?: number;
  applied_rotation?: number;
  fallback: boolean;
  orig_size?: number[];
  crop_size?: number[];
  /** 사이드카 미설정/오류로 크롭을 건너뛴 경우 사유 */
  skipped?: string;
}

export interface CropResult {
  buffer: Buffer;
  mimeType: string;
  meta: CropMeta;
}

// private Cloud Run(run.app) 크롭 사이드카 호출용 OIDC ID 토큰 — 게이트웨이의 processor 호출과 동일 패턴.
let cropAuth: import("google-auth-library").GoogleAuth | null = null;
async function authHeader(url: string): Promise<Record<string, string>> {
  if (process.env.CROP_SERVICE_TOKEN) return { authorization: `Bearer ${process.env.CROP_SERVICE_TOKEN}` };
  if (!url.includes("run.app")) return {};
  try {
    const { GoogleAuth } = await import("google-auth-library");
    cropAuth ??= new GoogleAuth();
    const client = await cropAuth.getIdTokenClient(url);
    const h = await client.getRequestHeaders();
    const tok = h["Authorization"] ?? h["authorization"];
    return tok ? { authorization: tok } : {};
  } catch {
    return {};
  }
}

/** 크롭 사이드카 호출. 실패 시 원본 반환(fail-open). */
export async function cropTable(
  imageBuffer: Buffer,
  mimeType: string = "image/jpeg",
  pad: number = 48,
): Promise<CropResult> {
  const url = process.env.CROP_SERVICE_URL;
  if (!url) {
    return { buffer: imageBuffer, mimeType, meta: { fallback: true, skipped: "CROP_SERVICE_URL 미설정" } };
  }

  const timeoutMs = Number(process.env.CROP_TIMEOUT_MS ?? 20000);
  try {
    const resp = await fetch(`${url.replace(/\/$/, "")}/crop`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeader(url)) },
      body: JSON.stringify({ image_b64: imageBuffer.toString("base64"), pad }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      return { buffer: imageBuffer, mimeType, meta: { fallback: true, skipped: `crop-svc ${resp.status}` } };
    }
    const json: any = await resp.json();
    const b64: string | undefined = json?.cropped_b64;
    if (!b64) {
      return { buffer: imageBuffer, mimeType, meta: { fallback: true, skipped: "cropped_b64 없음" } };
    }
    const meta: CropMeta = { fallback: false, ...(json?.meta ?? {}) };
    return { buffer: Buffer.from(b64, "base64"), mimeType: "image/png", meta };
  } catch (e) {
    return {
      buffer: imageBuffer,
      mimeType,
      meta: { fallback: true, skipped: `crop-svc 오류: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
}
