import { Storage } from "@google-cloud/storage";

/**
 * 결과 이미지 저장 — 두 모드:
 *  - GCS: GCS_RESULT_BUCKET 설정 시 업로드 후 V4 서명 URL 반환 (기본, 크기 제한 없음)
 *  - inline: 미설정 또는 STORAGE_MODE=local 시 base64 인라인 반환 (로컬/소형)
 *
 * Cloud Run 에서 서명 URL 생성은 런타임 SA 에
 * roles/iam.serviceAccountTokenCreator (self) 가 필요하다 (키 없이 signBlob).
 */

let storage: Storage | null = null;
function gcs(): Storage {
  if (!storage) storage = new Storage();
  return storage;
}

export interface StoredResult {
  mode: "gcs" | "inline";
  contentType: string;
  url?: string; // gcs
  bucket?: string; // gcs
  key?: string; // gcs
  base64?: string; // inline
}

export interface PresignResult {
  uploadUrl: string; // 클라이언트가 PUT 할 서명 URL (용량 무제한, base64 불필요)
  imageUrl: string; // 업로드 후 추출 API 에 넘길 읽기 서명 URL
  bucket: string;
  key: string;
  expiresIn: number; // 초
}

/**
 * 대용량/대량 업로드용 GCS 사전서명(presigned) URL 생성.
 * 클라이언트 → uploadUrl 로 이미지 PUT(최대 5GB) → imageUrl 을 추출 API 의 imageUrl 로 전달.
 * base64 32MB 한계·게이트웨이 페이로드 폭주를 우회한다. GCS_UPLOAD_BUCKET(없으면 GCS_RESULT_BUCKET) 사용.
 */
export async function presignUpload(contentType = "image/jpeg"): Promise<PresignResult | null> {
  const bucket = process.env.GCS_UPLOAD_BUCKET ?? process.env.GCS_RESULT_BUCKET;
  if (!bucket) return null; // 미설정 시 presign 불가(호출자는 base64 안내)
  const ttlSec = Number(process.env.UPLOAD_URL_TTL_SEC ?? 3600);
  const ext = contentType === "image/png" ? "png" : "jpg";
  const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const file = gcs().bucket(bucket).file(key);
  const expires = Date.now() + ttlSec * 1000;
  const [uploadUrl] = await file.getSignedUrl({ version: "v4", action: "write", expires, contentType });
  const [imageUrl] = await file.getSignedUrl({ version: "v4", action: "read", expires });
  return { uploadUrl, imageUrl, bucket, key, expiresIn: ttlSec };
}

export interface DatasetResult {
  bucket: string;
  key: string; // 영구 객체 키 (failed-crops/…)
  url: string | null; // 미리보기용 서명 URL (만료됨 — best-effort)
}

/**
 * 크롭 실패(fallback) 원본을 데이터셋으로 수집.
 * GCS_RESULT_BUCKET 안의 failed-crops/<YYYY-MM-DD>/<requestId>.<ext> 로 저장하고
 * 진단용 customMetadata(실패 사유·문서유형 등)를 붙인다. 미리보기 서명 URL은 best-effort.
 * 버킷 미설정·STORAGE_MODE=local 이면 수집하지 않고 null 반환(추출은 그대로 진행).
 * FAILED_CROP_COLLECT=off 로 킬스위치.
 */
export async function storeFailedCrop(
  image: Buffer,
  contentType: string,
  meta: Record<string, string | undefined>,
): Promise<DatasetResult | null> {
  const bucket = process.env.GCS_RESULT_BUCKET;
  if (!bucket || process.env.STORAGE_MODE === "local") return null;
  if (process.env.FAILED_CROP_COLLECT === "off") return null;

  const ext = contentType === "image/png" ? "png" : "jpg";
  const day = new Date().toISOString().slice(0, 10);
  const safeId = (meta.requestId ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  const rid = safeId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const key = `failed-crops/${day}/${rid}.${ext}`;
  const file = gcs().bucket(bucket).file(key);

  // customMetadata 값은 문자열만 허용 — undefined 는 제거.
  const custom: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) if (v != null && v !== "") custom[k] = String(v);

  await file.save(image, { contentType, resumable: false, metadata: { metadata: custom } });

  let url: string | null = null;
  try {
    const ttlMs = Number(process.env.DATASET_URL_TTL_SEC ?? 604800) * 1000; // 기본 7일(V4 최대)
    [url] = await file.getSignedUrl({ version: "v4", action: "read", expires: Date.now() + ttlMs });
  } catch {
    // 서명 실패 — 키만으로 충분(gsutil/재서명 가능)
  }
  return { bucket, key, url };
}

export async function storeResult(
  image: Buffer,
  contentType: string,
): Promise<StoredResult> {
  const bucket = process.env.GCS_RESULT_BUCKET;
  const local = process.env.STORAGE_MODE === "local";

  if (!bucket || local) {
    return { mode: "inline", contentType, base64: image.toString("base64") };
  }

  const ext = contentType === "image/jpeg" ? "jpg" : "png";
  const key = `annotated/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const file = gcs().bucket(bucket).file(key);

  await file.save(image, { contentType, resumable: false });

  const ttlMs = Number(process.env.SIGN_URL_TTL_SEC ?? 3600) * 1000;
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + ttlMs,
  });

  return { mode: "gcs", contentType, url, bucket, key };
}
