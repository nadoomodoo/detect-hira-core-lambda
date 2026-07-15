#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { preprocessImage, applyRotation } from "./preprocess.js";
import { detectHiraCodes, detectRotation, formatUsageStats, shouldApplyRotation } from "./ocr.js";
import { annotateImage, normalizeForAnnotation, resolveAnnotations } from "./annotate.js";
import type { ProcessResult } from "./types.js";

/**
 * 배치 실행 — 디렉토리의 모든 이미지를 병렬 처리하고 CSV 요약을 남긴다.
 *
 * 사용법:
 *   npm run batch [-- <입력디렉토리> <출력디렉토리>]
 *   (기본: edi-data → output/batch, 동시 실행 수는 BATCH_CONCURRENCY, 기본 8)
 *
 * Lambda 동시 호출처럼 파일 단위 워커 풀로 병렬 실행한다.
 * 출력 파일명은 원본 파일명을 그대로 유지한다 (확장자만 .png).
 * 한글 파일명은 macOS/리눅스에서 유효하므로 치환하지 않는다.
 */

const inDir = process.argv[2] ?? "edi-data";
const outDir = process.argv[3] ?? "output/batch";
const concurrency = Number(process.env.BATCH_CONCURRENCY) || 8;
mkdirSync(outDir, { recursive: true });

/** CSV 필드 이스케이프 (쉼표/따옴표/개행 포함 시 감싸기). */
function csv(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const files = readdirSync(inDir)
  .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
  .sort();
console.log(`처리할 파일: ${files.length}개 (${inDir} → ${outDir}, 동시 ${concurrency})\n`);

let done = 0;

/** 파일 1건 처리 → CSV 행 반환. */
async function processOne(i: number): Promise<string> {
  const f = files[i];
  try {
    const raw = readFileSync(join(inDir, f));

    const pre = await preprocessImage(raw);
    const rot = await detectRotation(pre.buffer, pre.mimeType);
    let working: Buffer = raw;
    let rotApplied = 0;
    if (shouldApplyRotation(rot)) {
      const r = await applyRotation(raw, rot.rotation);
      working = r.buffer;
      rotApplied = rot.rotation;
    }

    const preOcr = rotApplied === 0 ? pre : await preprocessImage(working);
    const dets = await detectHiraCodes(preOcr.buffer, preOcr.mimeType);

    // annotate 용 크기 정규화 (저해상도 원본 업스케일 — 라벨 배율 일관성)
    const norm = await normalizeForAnnotation(working);
    const { width, height } = norm;

    const { items, uniqueManufacturers } = await resolveAnnotations(dets, width, height);
    const foundCount = items.filter((it) => it.found).length;
    const tagged = uniqueManufacturers.length >= 2;

    // 9자리 코드는 인식됐지만 마스터에 없는 코드 — 마스터 갱신 필요 후보
    const unknownCodes = [...new Set(items.filter((it) => !it.found).map((it) => it.code))];
    if (unknownCodes.length > 0) {
      console.log(`  ⚠ ${f} — 마스터 미조회 코드 ${unknownCodes.length}건: ${unknownCodes.join(", ")}`);
    }

    if (tagged) {
      const result: ProcessResult = { items, width, height, uniqueManufacturers };
      const annotated = await annotateImage(norm.buffer, result);
      // 원본 파일명 유지, 확장자만 .png (annotate 출력이 PNG)
      const outName = f.replace(/\.[^.]+$/, ".png");
      mkdirSync(outDir, { recursive: true }); // 실행 중 외부 삭제 대비 재보장
      writeFileSync(join(outDir, outName), annotated);
    }

    done++;
    console.log(
      `[${done}/${files.length}] ${f} — 검출 ${dets.length}, 제약사 ${uniqueManufacturers.length}종${tagged ? " → 태깅" : ""}`,
    );
    return [
      i + 1,
      csv(f),
      rotApplied,
      dets.length,
      foundCount,
      uniqueManufacturers.length,
      tagged,
      csv(uniqueManufacturers.join("|")),
      "",
    ].join(",");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    done++;
    console.error(`[${done}/${files.length}] ${f} — 오류: ${msg}`);
    return [i + 1, csv(f), "", "", "", "", "", "", csv(msg)].join(",");
  }
}

// 워커 풀 — Lambda 동시 호출처럼 concurrency 개의 워커가 파일 큐를 소비
const rows = new Array<string>(files.length);
let nextIndex = 0;
async function worker(): Promise<void> {
  while (true) {
    const i = nextIndex++;
    if (i >= files.length) return;
    rows[i] = await processOne(i);
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

const header = "idx,file,rotation,detected,found,unique_mfrs,tagged,detail,error";
mkdirSync(outDir, { recursive: true }); // 실행 중 외부 삭제 대비 재보장
writeFileSync(join(outDir, "batch_results.csv"), [header, ...rows].join("\n") + "\n");
console.log(`\n${formatUsageStats()}`);
console.log(`\n완료: ${outDir}/batch_results.csv`);
