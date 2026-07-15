import sharp from "sharp";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { preprocessImage, applyRotation } from "./preprocess.js";
import { detectHiraCodes, detectRotation, formatUsageStats, shouldApplyRotation } from "./ocr.js";
import { annotateImage, normalizeForAnnotation, resolveAnnotations } from "./annotate.js";
import { loadDrugMaster } from "./master.js";
import type { ProcessResult } from "./types.js";

/**
 * AWS Lambda 핸들러 (API Gateway HTTP API v2 / Function URL 호환).
 *
 * 이미지 입력 방식 (우선순위 순):
 *   1. S3: { "inputBucket": "...", "inputKey": "..." }
 *      - 버킷 생략 시 환경변수 S3_INPUT_BUCKET 사용
 *   2. base64 JSON: { "image": "<base64>" }
 *   3. binary body (isBase64Encoded) — Function URL 직접 업로드
 *
 * 결과 출력 방식:
 *   - S3 출력 버킷(S3_OUTPUT_BUCKET)이 설정된 경우:
 *       결과 이미지를 S3에 PUT → presigned URL 반환
 *   - 미설정 시: base64 PNG 를 응답 body 에 직접 포함
 *
 * 배포 메모:
 *  - 마스터 CSV 와 한글 폰트는 Lambda Layer 또는 S3 에서 로드 (환경변수로 경로 지정).
 *  - sharp 는 arm64/x64 Lambda 네이티브 바이너리 호환 빌드 사용.
 *  - cold start 시 마스터 로드(22MB CSV) 수 초 → 전역 캐시로 1회만.
 */

// 전역 캐시 — 같은 Lambda 컨테이너 재사용 시 hit
let s3Client: S3Client | null = null;
let masterWarmed = false;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

/** 마스터 CSV 1회 로드 (컨테이너 재사용 시 캐시 hit). lambda-extract 와 공유. */
export async function warmMaster() {
  if (!masterWarmed) {
    await loadDrugMaster();
    masterWarmed = true;
  }
}

/** S3 에서 이미지 다운로드. */
async function downloadFromS3(bucket: string, key: string): Promise<Buffer> {
  const s3 = getS3Client();
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!resp.Body) throw new Error(`S3 객체가 비어있음: ${bucket}/${key}`);
  return Buffer.from(await resp.Body.transformToByteArray());
}

/** 이미지 버퍼의 MIME 타입 판별 (jpeg/png 외에는 png 로 간주). */
async function detectImageMime(image: Buffer): Promise<string> {
  const fmt = (await sharp(image).metadata()).format;
  return fmt === "jpeg" ? "image/jpeg" : "image/png";
}

/**
 * base64 인라인 응답용 이미지 크기 상한.
 * Lambda 응답 페이로드 제한 6MB — base64 는 원본의 ~1.37배이므로 4.3MB 로 잡는다.
 */
const MAX_INLINE_IMAGE_BYTES = Math.floor(4.3 * 1024 * 1024);

/**
 * 인라인(base64) 응답 한도에 맞게 이미지 축소.
 * 고용량 결과(대형 스캔의 annotate PNG 등)가 6MB 응답 제한을 넘지 않도록
 *  1) JPEG 재인코딩 → 2) 긴 변 3072px 다운스케일 순으로 시도.
 * 그래도 초과하면 S3 출력 설정을 안내하는 에러.
 */
async function fitForInlineResponse(
  image: Buffer,
  contentType: string,
): Promise<{ buffer: Buffer; contentType: string; reduced: string | null }> {
  if (image.length <= MAX_INLINE_IMAGE_BYTES) {
    return { buffer: image, contentType, reduced: null };
  }

  const jpeg = await sharp(image).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  if (jpeg.length <= MAX_INLINE_IMAGE_BYTES) {
    return { buffer: jpeg, contentType: "image/jpeg", reduced: "jpeg" };
  }

  const downscaled = await sharp(image)
    .resize({ width: 3072, height: 3072, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  if (downscaled.length <= MAX_INLINE_IMAGE_BYTES) {
    return { buffer: downscaled, contentType: "image/jpeg", reduced: "jpeg+downscale" };
  }

  throw new Error(
    "결과 이미지가 Lambda 응답 한도(6MB)를 초과합니다. S3_OUTPUT_BUCKET 을 설정해 presigned URL 방식을 사용하세요.",
  );
}

/** 결과 이미지를 S3에 업로드하고 presigned URL 반환. */
async function uploadToS3(
  image: Buffer,
  contentType: string = "image/png",
): Promise<{ bucket: string; key: string; url: string }> {
  const bucket = process.env.S3_OUTPUT_BUCKET;
  if (!bucket) throw new Error("S3_OUTPUT_BUCKET 환경변수가 설정되지 않음");
  const ext = contentType === "image/jpeg" ? "jpg" : "png";
  const key = `annotated/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  const s3 = getS3Client();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: image,
      ContentType: contentType,
    }),
  );

  const ttl = Number(process.env.S3_PRESIGN_TTL ?? 3600);
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttl },
  );

  return { bucket, key, url };
}

/**
 * 메인 처리 로직 — 회전 보정 + OCR + 마스터 조회 + 조건부 annotate.
 *
 * - 멀티 제약사: 라벨 합성된 PNG 반환 (tagged=true)
 * - 단일 제약사: annotate 없이 원본(회전 보정 적용본)을 그대로 반환 (tagged=false)
 */
async function processImage(raw: Buffer): Promise<{
  result: ProcessResult;
  image: Buffer;
  tagged: boolean;
}> {
  await warmMaster();

  // 1) 전처리 + 회전 판별
  const pre = await preprocessImage(raw);
  const rotation = await detectRotation(pre.buffer, pre.mimeType);

  let workingBuffer: Buffer = raw;
  if (shouldApplyRotation(rotation)) {
    const rotated = await applyRotation(raw, rotation.rotation);
    workingBuffer = rotated.buffer;
  }

  // 2) 보정된 이미지로 OCR
  const preRotated = await preprocessImage(workingBuffer);
  const detections = await detectHiraCodes(preRotated.buffer, preRotated.mimeType);

  // 3) annotate 용 크기 정규화 (저해상도 원본 업스케일 — 라벨 배율 일관성) + 마스터 조회
  const norm = await normalizeForAnnotation(workingBuffer);
  const { width, height } = norm;
  const { items, uniqueManufacturers } = await resolveAnnotations(detections, width, height);
  const result: ProcessResult = { items, width, height, uniqueManufacturers };

  // 4) 단일 제약사 → annotate 스킵, 원본(회전 보정 적용본) 그대로 반환
  if (uniqueManufacturers.length <= 1) {
    return { result, image: workingBuffer, tagged: false };
  }

  const annotated = await annotateImage(norm.buffer, result);
  return { result, image: annotated, tagged: true };
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const raw = await extractImageBuffer(event);
    if (!raw) {
      return json(400, {
        error: "이미지 입력이 필요합니다. { inputBucket, inputKey } 또는 { image: base64 }.",
      });
    }

    const { result, image, tagged } = await processImage(raw);

    // 인식됐지만 마스터에 없는 코드 → CloudWatch 로그 (마스터 갱신 필요 후보)
    const unknownCodes = [...new Set(result.items.filter((it) => !it.found).map((it) => it.code))];
    if (unknownCodes.length > 0) {
      console.log(`마스터 미조회 코드 ${unknownCodes.length}건: ${unknownCodes.join(", ")}`);
    }

    // 호출 수/토큰/지연시간 집계 → CloudWatch 로그 (컨테이너 수명 동안 누적)
    console.log(formatUsageStats());

    // 응답 본문 구성
    const base: Record<string, unknown> = {
      rotation: undefined,
      items: result.items.map((it) => ({
        code: it.code,
        manufacturer: it.manufacturer,
        drugName: it.drugName,
        found: it.found,
      })),
      uniqueManufacturers: result.uniqueManufacturers,
      width: result.width,
      height: result.height,
      tagged,
    };

    // 결과 이미지 출력 — 태깅 여부와 무관하게 항상 이미지 반환.
    // tagged=true: 라벨 합성 PNG / tagged=false: 원본(회전 보정 적용본) 그대로.
    const contentType = tagged ? "image/png" : await detectImageMime(image);
    if (process.env.S3_OUTPUT_BUCKET) {
      // S3 경로는 크기 제한 없음 — 고용량 이미지 권장 경로
      const uploaded = await uploadToS3(image, contentType);
      base.output = uploaded;
      base.imageUrl = uploaded.url;
    } else {
      // 폴백: base64 직접 반환 — 응답 6MB 제한에 맞게 필요 시 축소
      const fitted = await fitForInlineResponse(image, contentType);
      base.image = fitted.buffer.toString("base64");
      base.imageContentType = fitted.contentType;
      if (fitted.reduced) base.imageReduced = fitted.reduced;
    }

    return json(200, base);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(500, { error: msg });
  }
};

/**
 * API Gateway 이벤트에서 이미지 버퍼 추출.
 * 우선순위: S3 key > 원격 URL > base64 JSON > binary body.
 * 고용량 이미지는 S3 참조 또는 presigned URL(imageUrl) 사용 —
 * base64/binary 는 API Gateway(10MB)·Function URL(6MB) 페이로드 제한에 걸린다.
 * lambda-extract 와 공유.
 */
export async function extractImageBuffer(
  event: APIGatewayProxyEventV2,
): Promise<Buffer | null> {
  // 1) S3 참조: { inputBucket, inputKey }
  const body = parseBody(event);
  if (body && typeof body.inputKey === "string") {
    const bucket = String(body.inputBucket ?? process.env.S3_INPUT_BUCKET);
    if (!bucket) {
      throw new Error("inputBucket 이 없고 S3_INPUT_BUCKET 환경변수도 설정되지 않음");
    }
    return downloadFromS3(bucket, body.inputKey);
  }

  // 2) 원격 URL: { imageUrl: "https://..." } — presigned GET URL 등.
  //    페이로드 제한 없이 고용량 이미지 처리 가능. https 만 허용 (SSRF 완화).
  if (body && typeof body.imageUrl === "string") {
    const url = body.imageUrl;
    if (!url.startsWith("https://")) {
      throw new Error("imageUrl 은 https:// URL 만 허용됩니다");
    }
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`imageUrl 다운로드 실패: HTTP ${resp.status}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  }

  // 3) base64 JSON: { image: "<base64>" }
  if (body && typeof body.image === "string") {
    return Buffer.from(body.image, "base64");
  }

  // 4) binary body (Function URL 직접 업로드)
  if (event.body && event.isBase64Encoded) {
    return Buffer.from(event.body, "base64");
  }

  return null;
}

/** event body 를 객체로 파싱 (JSON 인 경우만). */
function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  if (!event.body) return null;
  if (event.isBase64Encoded) return null; // 바이너리는 JSON 아님
  const ct = event.headers?.["content-type"] ?? "";
  if (!ct.includes("application/json")) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

/** JSON 응답 헬퍼. */
function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}
