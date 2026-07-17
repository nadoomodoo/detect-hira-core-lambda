"use client";
import type { ResultViewProps } from "../types";
import { downloadBlob, openImageInNewTab } from "../download";

interface Item { code: string; manufacturer: string | null; drugName: string | null; found: boolean }

/** hira-detect(멀티 제약사 라벨링) 전용 결과 렌더: 원본/라벨 이미지 + 검출 표 + CSV·이미지 다운로드. */
export function HiraDetectResult({ result, preview, after, fileName }: ResultViewProps) {
  const items = (result.items as Item[] | undefined) ?? [];
  const tagged = !!result.tagged;

  // 원본파일명 분리 (예: "처방전.jpg" → base="처방전", ext="jpg")
  const dot = fileName ? fileName.lastIndexOf(".") : -1;
  const base = fileName ? (dot > 0 ? fileName.slice(0, dot) : fileName) : "result";
  const origExt = fileName && dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "jpg";
  // 라벨 합성본은 PNG, 단일(원본 반환)은 원본 확장자 유지
  const imageName = tagged ? `${base}_라벨추가.png` : `${base}_결과.${origExt}`;

  function downloadCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["약가코드", "제약사", "의약품", "조회"], ...items.map((it) => [it.code, it.manufacturer ?? "", it.drugName ?? "", it.found ? "O" : "X"])];
    downloadBlob(`${base}_검출.csv`, new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  }

  async function downloadImage() {
    if (!after) return;
    try {
      const blob = await (await fetch(after)).blob(); // data URI·CORS 허용 URL 모두 원하는 파일명으로
      downloadBlob(imageName, blob);
    } catch {
      window.open(after, "_blank", "noopener"); // 크로스오리진 CORS 차단 시 새 탭 폴백
    }
  }

  return (
    <>
      {tagged ? (
        <div className="demo-images">
          {preview && <figure><figcaption className="muted">원본 (클릭하면 크게 보기)</figcaption><img src={preview} alt="원본" style={{ cursor: "zoom-in" }} onClick={() => openImageInNewTab(preview)} /></figure>}
          {after && <figure><figcaption className="muted">결과 (제약사별 색상 태깅 · 클릭하면 크게 보기)</figcaption><img src={after} alt="결과" style={{ cursor: "zoom-in" }} onClick={() => openImageInNewTab(after)} /></figure>}
        </div>
      ) : (
        <div>
          <div className="demo-images demo-images-single">
            {preview && <figure><figcaption className="muted">원본 (클릭하면 크게 보기)</figcaption><img src={preview} alt="원본" style={{ cursor: "zoom-in" }} onClick={() => openImageInNewTab(preview)} /></figure>}
          </div>
          <p className="demo-note">
            ✓ <b>단일 제약사</b> 처방전입니다 — 색상 라벨 합성 없이 <b>원본이 그대로 반환</b>됩니다.
            (2곳 이상이면 제약사별로 색상 태깅한 결과 이미지를 반환합니다.)
          </p>
        </div>
      )}

      <h3 style={{ marginTop: 20, fontSize: 16, fontWeight: 700 }}>검출 결과 {items.length}건</h3>
      <table className="tbl" style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 8 }}>
        <thead><tr><th>약가코드</th><th>제약사</th><th>의약품</th></tr></thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="mono">{it.code}</td>
              <td>{it.manufacturer ?? <span className="muted">미조회</span>}</td>
              <td className="muted">{it.drugName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm btn-secondary" onClick={downloadCsv}>CSV 다운로드</button>
        {after && <button type="button" className="btn btn-sm btn-secondary" onClick={downloadImage}>이미지 다운로드</button>}
      </div>
    </>
  );
}
