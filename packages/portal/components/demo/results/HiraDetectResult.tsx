"use client";
import type { ResultViewProps } from "../types";
import { downloadBlob } from "../download";

interface Item { code: string; manufacturer: string | null; drugName: string | null; found: boolean }

/** hira-detect(멀티 제약사 라벨링) 전용 결과 렌더: 원본/라벨 이미지 + 검출 표 + CSV·이미지 다운로드. */
export function HiraDetectResult({ result, preview, after }: ResultViewProps) {
  const items = (result.items as Item[] | undefined) ?? [];
  const tagged = !!result.tagged;

  function downloadCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["약가코드", "제약사", "의약품", "조회"], ...items.map((it) => [it.code, it.manufacturer ?? "", it.drugName ?? "", it.found ? "O" : "X"])];
    downloadBlob("detect-result.csv", new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  }

  return (
    <>
      {tagged ? (
        <div className="demo-images">
          {preview && <figure><figcaption className="muted">원본 (클릭하면 크게 보기)</figcaption><a href={preview} target="_blank" rel="noopener noreferrer"><img src={preview} alt="원본" /></a></figure>}
          {after && <figure><figcaption className="muted">결과 (제약사별 색상 태깅 · 클릭하면 크게 보기)</figcaption><a href={after} target="_blank" rel="noopener noreferrer"><img src={after} alt="결과" /></a></figure>}
        </div>
      ) : (
        <div>
          <div className="demo-images demo-images-single">
            {preview && <figure><figcaption className="muted">원본 (클릭하면 크게 보기)</figcaption><a href={preview} target="_blank" rel="noopener noreferrer"><img src={preview} alt="원본" /></a></figure>}
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
        {after && <a className="btn btn-sm btn-secondary" href={after} download={tagged ? "labeled.png" : "original.jpg"}>이미지 다운로드</a>}
      </div>
    </>
  );
}
