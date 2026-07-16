import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AnnotatedCode, DetectedCode, PixelBox, ProcessResult } from "./types.js";
import { lookupDrug, lookupCoMarketing } from "./master.js";

/**
 * 이미지 위에 약가코드 박스 + 한글 제약사명을 합성(annotate) 한다.
 *
 * 레이아웃 (v0.3):
 *   ┌──────────┬─────────────────────────────┐
 *   │ 400px    │                             │
 *   │ 여백     │      원본 이미지             │
 *   │          │  ┌───┐                      │
 *   │  제약사A │  │   │                       │
 *   │  제약사B │  └───┘ ┌───┐                 │
 *   │ (우측정렬)│        │   │                 │
 *   └──────────┴────────┴───┘─────────────────┘
 *
 * - 마스터 조회 실패(알 수 없음) 항목은 렌더링에서 제외.
 * - 제약사별로 고유 색상 할당. 라벨 색 = 박스 색으로 매칭 (연결선 없음).
 * - 라벨은 400px 영역 안에서 우측 정렬.
 */

const DEFAULT_FONT_PATH =
  "/System/Library/Fonts/Supplemental/AppleGothic.ttf";

/** 왼쪽 라벨 영역 너비 (px). */
const LABEL_AREA_WIDTH = 400;

/**
 * annotate 대상 이미지의 최소 가로폭 (px).
 * 라벨 영역(400px)과 최소 폰트 크기가 고정이라, 저해상도 원본에
 * 그대로 그리면 라벨이 문서 대비 과대하게 보인다. 이 값 미만이면
 * annotate 전에 업스케일해 배율을 일정하게 유지한다.
 */
const MIN_ANNOTATE_WIDTH = 1600;

/**
 * annotate 용 이미지 정규화 — 가로폭이 MIN_ANNOTATE_WIDTH 미만이면
 * 종횡비를 보존하며 업스케일한 버퍼와 크기를 반환.
 * OCR 좌표는 0~1000 정규화라 결과 크기 기준으로 그대로 역변환 가능.
 */
export async function normalizeForAnnotation(
  imageBuffer: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || width >= MIN_ANNOTATE_WIDTH) {
    return { buffer: imageBuffer, width, height };
  }
  const scale = MIN_ANNOTATE_WIDTH / width;
  const newW = MIN_ANNOTATE_WIDTH;
  const newH = Math.round(height * scale);
  const buffer = await sharp(imageBuffer, { failOn: "none" })
    .resize({ width: newW, height: newH })
    .toBuffer();
  return { buffer, width: newW, height: newH };
}

/** 제약사별 색상 쌍. fill = 박스 채움(파스텔), label = 라벨 텍스트(같은 계열 진한 색). */
interface ColorPair {
  fill: string;
  label: string;
}

/**
 * 제약사별 색상 팔레트 20색 (파스텔톤).
 * 연결선 없이 색으로만 라벨↔박스를 매칭하므로, 제약사 수가 팔레트를
 * 초과해 색이 겹치지 않도록 넉넉하게 확보. 인접 색상이 구분되도록 색상환을 교차 배치.
 * 파스텔 fill 은 흰 배경 텍스트 라벨로는 대비가 약하므로, 라벨은 같은 계열의 진한 색 사용.
 */
const COLOR_PALETTE: ColorPair[] = [
  { fill: "#fca5a5", label: "#b91c1c" }, // 빨강
  { fill: "#93c5fd", label: "#1d4ed8" }, // 파랑
  { fill: "#86efac", label: "#15803d" }, // 초록
  { fill: "#d8b4fe", label: "#7e22ce" }, // 보라
  { fill: "#fdba74", label: "#c2410c" }, // 주황
  { fill: "#5eead4", label: "#0f766e" }, // 틸
  { fill: "#f9a8d4", label: "#be185d" }, // 분홍
  { fill: "#bef264", label: "#4d7c0f" }, // 라임
  { fill: "#a5b4fc", label: "#4338ca" }, // 인디고
  { fill: "#fcd34d", label: "#b45309" }, // 앰버
  { fill: "#67e8f9", label: "#0e7490" }, // 시안
  { fill: "#f0abfc", label: "#a21caf" }, // 자홍
  { fill: "#6ee7b7", label: "#047857" }, // 에메랄드
  { fill: "#fda4af", label: "#be123c" }, // 로즈
  { fill: "#7dd3fc", label: "#0369a1" }, // 하늘
  { fill: "#fde047", label: "#a16207" }, // 노랑
  { fill: "#c4b5fd", label: "#6d28d9" }, // 바이올렛
  { fill: "#cbd5e1", label: "#334155" }, // 슬레이트
  { fill: "#d2b48c", label: "#92400e" }, // 갈색
  { fill: "#d6d3d1", label: "#57534e" }, // 스톤
];

/** 폰트를 base64 데이터 URI 로 읽어 SVG 에 임베드. */
function loadFontAsDataUri(): string {
  const fontPath = resolve(process.env.FONT_PATH ?? DEFAULT_FONT_PATH);
  if (!existsSync(fontPath)) {
    throw new Error(`한글 폰트 파일을 찾을 수 없습니다: ${fontPath}`);
  }
  const buf = readFileSync(fontPath);
  return `data:font/ttf;base64,${buf.toString("base64")}`;
}

/** 정규화 좌표 [y1, x1, y2, x2] (0~1000) 를 픽셀 좌표로 변환. */
export function toPixelBox(
  box: [number, number, number, number],
  width: number,
  height: number,
): PixelBox {
  const [y1, x1, y2, x2] = box;
  const px = (v: number, max: number) => Math.round((v / 1000) * max);
  const left = px(x1, width);
  const top = px(y1, height);
  const right = px(x2, width);
  const bottom = px(y2, height);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** SVG 텍스트로 특수문자 이스케이프. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 감지된 코드 목록을 마스터 조회와 결합해 AnnotatedCode 목록으로 변환. */
export async function resolveAnnotations(
  detections: DetectedCode[],
  width: number,
  height: number,
): Promise<{ items: AnnotatedCode[]; uniqueManufacturers: string[] }> {
  const items: AnnotatedCode[] = [];
  const manufacturerSet = new Set<string>();

  for (const det of detections) {
    const record = await lookupDrug(det.code);
    const pixelBox = toPixelBox(det.box, width, height);
    const found = record !== null;
    // 코마케팅 표기 오버라이드(전역): 매핑이 있으면 마스터 제약사명 대신 표기명 사용
    const override = await lookupCoMarketing(det.code);
    const manufacturer = override ?? record?.manufacturer ?? null;
    if (manufacturer) {
      manufacturerSet.add(manufacturer);
    }
    items.push({
      ...det,
      pixelBox,
      manufacturer,
      drugName: record?.drugName ?? null,
      found,
    });
  }

  return { items, uniqueManufacturers: [...manufacturerSet] };
}

/** 제약사명 → 색상 쌍 매핑 생성. 등장 순서대로 팔레트에서 순환 할당. */
function buildColorMap(manufacturers: string[]): Map<string, ColorPair> {
  const map = new Map<string, ColorPair>();
  manufacturers.forEach((mfr, i) => {
    map.set(mfr, COLOR_PALETTE[i % COLOR_PALETTE.length]);
  });
  return map;
}

/**
 * 원본 이미지 버퍼 위에 SVG 오버레이를 합성한 결과 버퍼를 반환.
 *
 * - 왼쪽에 LABEL_AREA_WIDTH(400px) 흰 여백 추가.
 * - 마스터 조회 성공(found) 항목만 렌더링. 알 수 없음은 제외.
 * - 제약사별 색상으로 박스 + 라벨 + 점선 연결.
 */
export async function annotateImage(
  imageBuffer: Buffer,
  result: ProcessResult,
): Promise<Buffer> {
  const { width, height, items, uniqueManufacturers } = result;
  const fontUri = loadFontAsDataUri();

  // 조회 성공 항목만 렌더링 대상
  const foundItems = items.filter((it) => it.found && it.manufacturer);
  if (foundItems.length === 0) {
    // 표시할 항목이 없으면 여백만 추가한 원본 반환
    return sharp(imageBuffer)
      .extend({
        top: 0,
        bottom: 0,
        left: LABEL_AREA_WIDTH,
        background: { r: 255, g: 255, b: 255 },
      })
      .png()
      .toBuffer();
  }

  const colorMap = buildColorMap(uniqueManufacturers);

  const labelPadding = 20;
  const labelAreaInnerWidth = LABEL_AREA_WIDTH - labelPadding * 2;

  // 폰트 크기: 이미지 높이 기반, 최소 18px.
  // 단, 가장 긴 제약사명이 라벨 영역(한글 글리프 폭 ≈ 1em)을 넘지 않도록 상한.
  const maxNameLen = Math.max(...uniqueManufacturers.map((m) => m.length), 1);
  const fontSize = Math.min(
    Math.max(18, Math.round(height * 0.022)),
    Math.floor(labelAreaInnerWidth / maxNameLen),
  );

  // 제약사별 라벨 Y 위치: 해당 제약사의 "최상단 박스" 중심에 정렬.
  // (균등 분배는 박스와 무관한 위치에 라벨이 떠 보이는 문제가 있었음)
  const desiredY = new Map<string, number>();
  for (const item of foundItems) {
    const mfr = item.manufacturer!;
    const yMid = item.pixelBox.y + item.pixelBox.height / 2;
    const cur = desiredY.get(mfr);
    if (cur === undefined || yMid < cur) desiredY.set(mfr, yMid);
  }

  // 겹침 방지: 원하는 Y 순으로 정렬 후 최소 간격 유지 (위→아래로 밀어냄)
  const minGap = Math.round(fontSize * 1.8);
  const byY = [...uniqueManufacturers].sort(
    (a, b) => (desiredY.get(a) ?? 0) - (desiredY.get(b) ?? 0),
  );
  const labelYMap = new Map<string, number>();
  let prevY = -Infinity;
  for (const mfr of byY) {
    let y = Math.round(desiredY.get(mfr) ?? 0);
    if (y - prevY < minGap) y = prevY + minGap;
    labelYMap.set(mfr, y);
    prevY = y;
  }
  // 하단 넘침 방지: 마지막 라벨이 캔버스를 벗어나면 아래→위로 되밀기
  let maxAllowed = height - fontSize;
  for (let i = byY.length - 1; i >= 0; i--) {
    const mfr = byY[i];
    let y = labelYMap.get(mfr)!;
    if (y > maxAllowed) {
      y = maxAllowed;
      labelYMap.set(mfr, y);
    }
    maxAllowed = y - minGap;
  }

  // 전체 캔버스 크기 (원본 + 왼쪽 여백)
  const totalWidth = width + LABEL_AREA_WIDTH;

  const elements: string[] = [];

  // 1) 제약사별 라벨 (왼쪽 여백 영역, 우측 정렬)
  //    박스와 동일한 반투명 파스텔 하이라이트를 라벨 뒤에 깔아
  //    라벨 색 ↔ 박스 색이 정확히 같은 색으로 보이게 한다.
  for (const mfr of uniqueManufacturers) {
    const color = colorMap.get(mfr)!;
    const labelY = labelYMap.get(mfr)!;
    const textX = LABEL_AREA_WIDTH - labelPadding;
    const textY = labelY + Math.round(fontSize / 3); // baseline 보정

    // 하이라이트 영역: 텍스트 폭 추정(한글 글리프 ≈ 1em) + 상하 여유
    const textWidth = Math.ceil(mfr.length * fontSize);
    const hlPad = Math.round(fontSize * 0.25);
    const hlX = textX - textWidth - hlPad;
    const hlY = labelY - Math.round(fontSize / 2) - hlPad;
    const hlW = textWidth + hlPad * 2;
    const hlH = fontSize + hlPad * 2;

    elements.push(
      `  <rect x="${hlX}" y="${hlY}" width="${hlW}" height="${hlH}" rx="4" fill="${color.fill}" fill-opacity="0.6" stroke="none"/>`,
      `  <text x="${textX}" y="${textY}" text-anchor="end" font-family="KrFont" font-size="${fontSize}" font-weight="bold" fill="${color.label}">${escapeXml(mfr)}</text>`,
    );
  }

  // 2) 각 약가코드 박스 — 테두리 없이 파스텔 반투명 채움 (라벨과는 색상으로만 매칭)
  for (const item of foundItems) {
    const { x, y, width: w, height: h } = item.pixelBox;
    const mfr = item.manufacturer!;
    const color = colorMap.get(mfr)!;

    // 박스 좌표는 왼쪽 여백(LABEL_AREA_WIDTH)만큼 오른쪽으로 이동
    const boxX = x + LABEL_AREA_WIDTH;
    const boxY = y;

    elements.push(
      `  <!-- code: ${escapeXml(item.code)} → ${escapeXml(mfr)} -->`,
      `  <rect x="${boxX}" y="${boxY}" width="${w}" height="${h}" fill="${color.fill}" fill-opacity="0.6" stroke="none"/>`,
    );
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}">
  <defs>
    <style>
      @font-face {
        font-family: "KrFont";
        src: url("${fontUri}") format("truetype");
      }
    </style>
  </defs>
${elements.join("\n")}
</svg>`;

  const overlay = Buffer.from(svg);

  // 원본 왼쪽에 흰 여백 추가 후 SVG 오버레이 합성
  const extended = await sharp(imageBuffer)
    .extend({
      top: 0,
      bottom: 0,
      left: LABEL_AREA_WIDTH,
      background: { r: 255, g: 255, b: 255 },
    })
    .toBuffer();

  return sharp(extended)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/** ProcessResult 를 콘솔 요약용으로 포맷. */
export function formatSummary(result: ProcessResult): string {
  const lines = result.items.map((it, i) => {
    const status = it.found ? "✓" : "✗";
    const mfr = it.manufacturer ?? "알 수 없음";
    const name = it.drugName ?? "";
    const b = it.pixelBox;
    return `  [${i + 1}] ${status} ${it.code} → ${mfr}${name ? ` (${name})` : ""}  [box: ${b.x},${b.y} ${b.width}x${b.height}]`;
  });
  const found = result.items.filter((i) => i.found).length;
  const total = result.items.length;
  const mfrCount = result.uniqueManufacturers.length;
  return [
    `검출 ${total}건 (조회 성공 ${found}건), 제약사 ${mfrCount}종, 이미지 ${result.width}x${result.height}`,
    ...lines,
  ].join("\n");
}
