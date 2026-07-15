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
