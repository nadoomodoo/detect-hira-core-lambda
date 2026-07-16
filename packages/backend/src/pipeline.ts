import { preprocessImage, applyRotation } from "./preprocess.js";
import { detectHiraCodes, detectRotation, shouldApplyRotation } from "./ocr.js";
import { annotateImage, normalizeForAnnotation, resolveAnnotations } from "./annotate.js";
import { loadDrugMaster } from "./master.js";
import type { ProcessResult } from "./types.js";

/**
 * 클라우드 무관 코어 파이프라인 (Cloud Run / Lambda / CLI 공용).
 *
 *   전처리 → 회전 판별/보정 → OCR → 마스터 조회 → 조건부 annotate
 *
 * - 멀티 제약사: 라벨 합성 PNG (tagged=true)
 * - 단일 제약사: annotate 스킵, 회전 보정본 원본 그대로 (tagged=false)
 */

let masterWarmed = false;

/** 마스터 데이터 1회 로드 (컨테이너 수명 동안 캐시). */
export async function warmMaster(): Promise<void> {
  if (!masterWarmed) {
    await loadDrugMaster();
    masterWarmed = true;
  }
}

export interface ProcessOutcome {
  result: ProcessResult;
  image: Buffer;
  tagged: boolean;
  rotation: number;
}

export async function processImage(raw: Buffer): Promise<ProcessOutcome> {
  await warmMaster();

  // 1) 전처리 + 회전 판별
  const pre = await preprocessImage(raw);
  const rot = await detectRotation(pre.buffer, pre.mimeType);

  let workingBuffer: Buffer = raw;
  let appliedRotation = 0;
  if (shouldApplyRotation(rot)) {
    const rotated = await applyRotation(raw, rot.rotation);
    workingBuffer = rotated.buffer;
    appliedRotation = rot.rotation;
  }

  // 2) 보정된 이미지로 OCR
  const preRotated = await preprocessImage(workingBuffer);
  const detections = await detectHiraCodes(preRotated.buffer, preRotated.mimeType);

  // 3) annotate 용 정규화 + 마스터 조회 (코마케팅 표기 오버라이드는 resolveAnnotations 내부에서 적용)
  const norm = await normalizeForAnnotation(workingBuffer);
  const { width, height } = norm;
  const { items, uniqueManufacturers } = await resolveAnnotations(detections, width, height);
  const result: ProcessResult = { items, width, height, uniqueManufacturers };

  // 4) 단일 제약사 → annotate 스킵, 회전 보정본 그대로
  if (uniqueManufacturers.length <= 1) {
    return { result, image: workingBuffer, tagged: false, rotation: appliedRotation };
  }

  // 5) 멀티 제약사 → 라벨 합성
  const annotated = await annotateImage(norm.buffer, result);
  return { result, image: annotated, tagged: true, rotation: appliedRotation };
}
