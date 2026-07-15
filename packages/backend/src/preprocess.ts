import sharp from "sharp";

/**
 * 이미지 전처리 — Gemini 토큰/비용 절약용.
 *
 * Gemini 는 768px 타일 단위로 이미지를 토큰화한다:
 *   tiles = ceil(width / 768) × ceil(height / 768), 타일당 258 토큰.
 * 긴 변이 769px 만 넘어도 타일이 1→4 로 점프하므로, 리사이즈가 비용에 직결된다.
 *
 * 본 모듈은 종횡비를 보존하며
 *  - 짧은 변을 PREPROCESS_MIN_SHORT_EDGE (기본 1000) 이상으로 스케일 업,
 *  - 긴 변을 PREPROCESS_MAX_LONG_EDGE_CAP (기본 4096) 이하로 스케일 다운
 * 한 뒤 JPEG 재인코딩한다. 두 조건이 충돌하면 짧은 변 최소값을 우선한다.
 *
 * bbox 는 0~1000 정규화 좌표로 받으므로, 종횡비만 보존되면
 * 리사이즈 여부와 무관하게 원본 좌표로 정확히 역변환된다 (annotate.toPixelBox).
 *
 * VLM 이 스스로 이미지 품질을 보정하므로 그레이스케일/CLAHE/이진화 등은
 * 하지 않는다 (오히려 정보 손실로 정확도 하락).
 *
 * 회전: EXIF 는 신뢰하지 않는다 (raw 픽셀과 충돌하는 경우가 잦음).
 * 회전은 ocr.ts 의 detectRotation() 결과로 판별하여 applyRotation() 으로 적용.
 */

const DEFAULT_MIN_SHORT_EDGE = 1000;
const DEFAULT_MAX_LONG_EDGE_CAP = 4096;
const DEFAULT_JPEG_QUALITY = 88;

export interface PreprocessOptions {
  /** 짧은 변의 최소 픽셀. 이 값보다 작으면 스케일 업. 세로 긴 이미지에서 글씨가 작아지는 것을 방지. */
  minShortEdge?: number;
  /** 긴 변의 상한 픽셀. 토큰 과다 방지 (이 값을 초과해도 축소하되 짧은 변은 minShortEdge 이하로 안 내려감). */
  maxLongEdgeCap?: number;
  /** JPEG 재인코딩 화질 (1~100). */
  jpegQuality?: number;
}

export interface PreprocessResult {
  /** 전처리된 이미지 버퍼 (JPEG). */
  buffer: Buffer;
  /** MIME 타입 (항상 image/jpeg). */
  mimeType: string;
  /** 전처리 후 가로 (px). */
  width: number;
  /** 전처리 후 세로 (px). */
  height: number;
  /** 예상 타일 수. */
  tiles: number;
  /** 예상 이미지 토큰 수. */
  estimatedTokens: number;
  /** 리사이즈가 수행되었는지 여부. */
  resized: boolean;
}

/** 환경변수 기반 기본 옵션. */
function defaultOptions(): PreprocessOptions {
  const minShortEdge = Number(process.env.PREPROCESS_MIN_SHORT_EDGE);
  const maxLongEdgeCap = Number(process.env.PREPROCESS_MAX_LONG_EDGE_CAP);
  const jpegQuality = Number(process.env.PREPROCESS_JPEG_QUALITY);
  return {
    minShortEdge: Number.isFinite(minShortEdge) && minShortEdge > 0 ? minShortEdge : DEFAULT_MIN_SHORT_EDGE,
    maxLongEdgeCap: Number.isFinite(maxLongEdgeCap) && maxLongEdgeCap > 0 ? maxLongEdgeCap : DEFAULT_MAX_LONG_EDGE_CAP,
    jpegQuality: Number.isFinite(jpegQuality) && jpegQuality > 0 ? jpegQuality : DEFAULT_JPEG_QUALITY,
  };
}

/**
 * 이미지 버퍼를 전처리해 Gemini 전송용 JPEG 버퍼를 반환.
 *
 * 수행 작업:
 *  1. 종횡비 보존 리사이즈 — 짧은 변 기준 (세로 긴 이미지에서 글씨 작아짐 방지)
 *  2. JPEG 재인코딩 (파일 크기 절약)
 *
 * 리사이즈 규칙 (짧은 변 보장 방식):
 *  - 짧은 변 < minShortEdge (기본 1000): 스케일 업하여 짧은 변 보장
 *  - 긴 변 > maxLongEdgeCap (기본 4096): 축소하되 짧은 변은 minShortEdge 이하로 안 내려감
 *  - 그 외: 원본 크기 유지
 *
 * 세로로 긴 이미지(예: 여러 처방전 이어붙음)에서 긴 변을 강제 축소하면
 * 폭이 좁아져 약가코드 숫자가 작아지고 OCR 이 누락되는 문제를 해결한다.
 */
export async function preprocessImage(
  imageBuffer: Buffer,
  options: PreprocessOptions = {},
): Promise<PreprocessResult> {
  const opts = { ...defaultOptions(), ...options };
  // EXIF 회전 미적용 — 회전은 Gemini 판별 결과(detectRotation)로만 처리.
  const pipeline = sharp(imageBuffer, { failOn: "none" });

  // 원본 크기 조회
  const meta = await pipeline.metadata();
  const origW = meta.width ?? 0;
  const origH = meta.height ?? 0;
  const origShort = Math.min(origW, origH);
  const origLong = Math.max(origW, origH);

  // 스케일 결정 (종횡비 보존):
  //  1) 짧은 변이 minShortEdge 미만이면 스케일 업 (작은 글씨 OCR 정확도 확보)
  //  2) 긴 변이 maxLongEdgeCap 초과면 스케일 다운 (토큰 과다 방지)
  //  3) 단, 축소로 짧은 변이 minShortEdge 아래로 내려가면 minShortEdge 를 우선
  let scale = 1;
  const minShort = opts.minShortEdge ?? 0;
  const cap = opts.maxLongEdgeCap ?? 0;
  if (minShort > 0 && origShort > 0 && origShort < minShort) {
    scale = minShort / origShort;
  }
  if (cap > 0 && origLong * scale > cap) {
    scale = cap / origLong;
    if (minShort > 0 && origShort * scale < minShort) {
      scale = minShort / origShort;
    }
  }

  let resized = false;
  if (scale !== 1 && origW > 0 && origH > 0) {
    pipeline.resize({
      width: Math.round(origW * scale),
      height: Math.round(origH * scale),
    });
    resized = true;
  }

  const quality = opts.jpegQuality ?? DEFAULT_JPEG_QUALITY;
  const buffer = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();

  const after = await sharp(buffer).metadata();
  const width = after.width ?? 0;
  const height = after.height ?? 0;
  const tiles = Math.ceil(width / 768) * Math.ceil(height / 768);

  return {
    buffer,
    mimeType: "image/jpeg",
    width,
    height,
    tiles,
    estimatedTokens: tiles * 258,
    resized,
  };
}

/**
 * 이미지를 시계방향으로 angle 도 회전.
 *
 * Gemini 의 detectRotation() 결과를 적용할 때 사용.
 * - 0: 회전 없음 (원본 그대로 반환).
 * - 90/180/270: Sharp 의 rotate() 적용. Sharp.rotate 는 반시계방향이므로
 *   시계방향 angle 을 보정하려면 음수로 전달.
 *
 * 회전 후의 메타데이터(width/height 가 뒤바뀔 수 있음)도 함께 반환.
 */
export async function applyRotation(
  imageBuffer: Buffer,
  angle: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (angle === 0) {
    const meta = await sharp(imageBuffer).metadata();
    return {
      buffer: imageBuffer,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    };
  }

  // Sharp.rotate(angle) 는 반시계방향(counterclockwise) 회전.
  // 시계방향 angle 을 적용하려면 -angle 전달.
  const rotated = await sharp(imageBuffer, { failOn: "none" })
    .rotate(-angle)
    .toBuffer();

  const meta = await sharp(rotated).metadata();
  return {
    buffer: rotated,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

