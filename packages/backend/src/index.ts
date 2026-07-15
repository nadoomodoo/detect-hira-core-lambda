#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { preprocessImage, applyRotation } from "./preprocess.js";
import { detectHiraCodes, detectRotation, formatUsageStats, shouldApplyRotation } from "./ocr.js";
import { annotateImage, normalizeForAnnotation, resolveAnnotations, formatSummary } from "./annotate.js";
import type { ProcessResult } from "./types.js";

/**
 * CLI 진입점.
 *
 * 사용법:
 *   npx tsx src/index.ts <입력이미지경로> [출력이미지경로]
 *
 * 파이프라인 (v0.2):
 *   원본 이미지 로드
 *   → 전처리(리사이즈/JPEG) [토큰 절약, EXIF 회전 미적용]
 *   → [1차] Gemini 회전 판별 → 각도 있으면 Sharp로 보정
 *   → [2차] 보정된 이미지로 Gemini OCR (9자리 약가코드 + 정규화 좌표)
 *   → 마스터 조회 (drug_code → 제약사명) → 유니크 제약사 수 계산
 *   → 단일 제약사? → 요약만 출력 (annotate 스킵)
 *   → 멀티 제약사? → 왼쪽 400px 여백 + 점선 라벨 합성 → 저장
 */

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "사용법: npx tsx src/index.ts <입력이미지> [출력이미지]\n" +
        "예:   npx tsx src/index.ts edi-data/처방전.jpg output/result.png",
    );
    process.exit(1);
  }

  const inputPath = resolve(args[0]);
  const outputPath = args[1]
    ? resolve(args[1])
    : defaultOutputPath(inputPath);

  if (!existsSync(inputPath)) {
    console.error(`입력 이미지를 찾을 수 없습니다: ${inputPath}`);
    process.exit(1);
  }

  const raw = readFileSync(inputPath);

  console.log(`▶ 입력: ${inputPath} (${(raw.length / 1024).toFixed(0)}KB)`);

  // 1) 전처리 — Gemini 전송용 (EXIF 회전 미적용)
  const pre = await preprocessImage(raw);
  console.log(
    `▶ 전처리: ${pre.width}x${pre.height} JPEG ${(pre.buffer.length / 1024).toFixed(0)}KB` +
      ` | ${pre.tiles}타일 ≈${pre.estimatedTokens}토큰${pre.resized ? " (리사이즈됨)" : ""}`,
  );

  // 2) [1차] 회전 판별 (Gemini, 경량 호출)
  console.log("▶ 회전 판별 중 (Gemini)...");
  const rotation = await detectRotation(pre.buffer, pre.mimeType);
  console.log(
    `  회전: ${rotation.rotation}° (confidence=${rotation.confidence.toFixed(2)})`,
  );

  // 3) 회전 보정이 필요하면 원본에 적용
  let workingBuffer: Buffer = raw;
  if (shouldApplyRotation(rotation)) {
    console.log(`▶ 회전 보정 적용: ${rotation.rotation}°`);
    const rotated = await applyRotation(raw, rotation.rotation);
    workingBuffer = rotated.buffer;
  }

  // 4) OCR용 재전처리 (회전 후 크기 변동 반영)
  //    짧은 변 최소 1000px 보장(minShortEdge) — 빽빽한 표에서 bbox 정밀도 확보.
  const preRotated = await preprocessImage(workingBuffer);

  // 5) [2차] OCR — 약가코드 검출
  console.log("▶ OCR 호출 중 (Gemini)...");
  const detections = await detectHiraCodes(preRotated.buffer, preRotated.mimeType);
  console.log(`▶ 검출: ${detections.length}건`);

  if (detections.length === 0) {
    console.log("검출된 약가코드가 없습니다.");
    process.exit(0);
  }

  // 6) annotate 용 크기 정규화 (저해상도 원본 업스케일 — 라벨 배율 일관성)
  //    + 마스터 조회 결합 (정규화된 이미지 기준 좌표)
  const norm = await normalizeForAnnotation(workingBuffer);
  const { width, height } = norm;
  const { items, uniqueManufacturers } = await resolveAnnotations(detections, width, height);

  const result: ProcessResult = {
    items,
    width,
    height,
    uniqueManufacturers,
  };

  console.log(formatSummary(result));

  // 7) 단일 제약사 → annotate 스킵
  if (uniqueManufacturers.length <= 1) {
    const mfr = uniqueManufacturers[0] ?? "(조회된 제약사 없음)";
    console.log(`▶ 단일 제약사(${mfr}) — 태깅 생략`);
    return;
  }

  // 8) 멀티 제약사 → 왼쪽 여백 라벨 + 파스텔 채움 합성 (정규화된 이미지 기준)
  console.log(`▶ 멀티 제약사(${uniqueManufacturers.length}종) — 태깅 합성 중...`);
  const annotated = await annotateImage(norm.buffer, result);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, annotated);
  console.log(formatUsageStats());
  console.log(`▶ 완료: ${outputPath}`);
}

/** 입력 경로 기반 기본 출력 경로: output/<원본명>_annotated.png */
function defaultOutputPath(inputPath: string): string {
  const base = inputPath.replace(/\.[^.]+$/, "");
  return join(dirname(inputPath), "..", "output", `${base.split("/").pop()}_annotated.png`);
}

main().catch((err) => {
  console.error("오류:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
