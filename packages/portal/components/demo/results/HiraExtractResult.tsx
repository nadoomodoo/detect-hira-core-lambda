"use client";
import type { ResultViewProps } from "../types";
import { downloadBlob, openImageInNewTab } from "../download";

/** hira-extract 응답의 items 스키마(외부 API와 동일). */
interface Item {
  drugCode: string | null;
  drugName: string | null;
  quantity: number | null;
  days: number | null;
  prescribedQty: number | null;
  unitPrice: number | null;
  totalAmount: number | null;
  codeInMaster?: boolean;
  priceCheck?: "current" | "historical" | "mismatch" | "none";
  status: "GREEN" | "YELLOW" | "RED";
  needsReview?: boolean;
  review?: string[];
}

const dot: Record<string, string> = { GREEN: "🟢", YELLOW: "🟡", RED: "🔴" };
const priceLabel: Record<string, string> = {
  current: "현재가 일치",
  historical: "과거가(단가변동)",
  mismatch: "단가 불일치",
  none: "—",
};
const issueLabel: Record<string, string> = {
  blur: "흐림", dark: "어두움", glare: "빛반사", skew: "기울어짐",
  rotated: "회전", partial: "표 일부 잘림", low_res: "저해상도", noise: "노이즈",
};
const docTypeLabel: Record<string, string> = {
  drug_table: "약품 표",
  business_registration: "사업자등록증",
  prescription: "처방전(표 아님)",
  receipt: "영수증/계산서",
  other: "기타 문서",
  unknown: "판별 불가",
};

/** hira-extract 전용 결과 뷰: 원본 미리보기 + 약품 라인아이템 표 + CSV. */
export function HiraExtractResult({ result, preview, fileName }: ResultViewProps) {
  const items = (result.items as Item[] | undefined) ?? [];
  const summary = (result.summary as { items?: number; needsReview?: number; byStatus?: { green: number; yellow: number; red: number } } | undefined) ?? {};
  const byStatus = summary.byStatus ?? { green: 0, yellow: 0, red: 0 };
  const meta = (result.meta as { imageReadable?: boolean; imageIssues?: string[] } | undefined) ?? {};
  const foundTable = !!result.foundTable;
  const documentType = (result.documentType as string | undefined) ?? "unknown";
  const base = fileName ? fileName.replace(/\.[^.]+$/, "") : "extract";

  function downloadCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["약품코드", "약품명", "수량", "일수", "총처방량", "단가", "총금액", "마스터", "단가검증", "상태", "확인필요", "사유"];
    const body = items.map((r) => [r.drugCode ?? "", r.drugName ?? "", r.quantity ?? "", r.days ?? "", r.prescribedQty ?? "", r.unitPrice ?? "", r.totalAmount ?? "", r.codeInMaster ? "O" : "X", priceLabel[r.priceCheck ?? "none"], r.status, r.needsReview ? "Y" : "", (r.review ?? []).join("; ")]);
    downloadBlob(`${base}_추출.csv`, new Blob(["﻿" + [header, ...body].map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  }

  return (
    <>
      <div className="demo-images demo-images-single">
        {preview && <figure><figcaption className="muted">원본 (클릭하면 크게 보기)</figcaption><img src={preview} alt="원본" style={{ cursor: "zoom-in" }} onClick={() => openImageInNewTab(preview)} /></figure>}
      </div>

      {(meta.imageReadable === false || (meta.imageIssues && meta.imageIssues.length > 0)) && (
        <p className="demo-note" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>
          ⚠︎ 이미지 품질 문제{meta.imageReadable === false ? "(읽기 어려움 — 재촬영 권장)" : ""}
          {meta.imageIssues && meta.imageIssues.length > 0 ? `: ${meta.imageIssues.map((i) => issueLabel[i] ?? i).join(", ")}` : ""}
        </p>
      )}

      {!foundTable ? (
        <p className="demo-note">
          약품 표를 찾지 못했습니다. <b>문서 유형: {docTypeLabel[documentType] ?? documentType}</b>
          {documentType === "business_registration" || documentType === "receipt" || documentType === "other"
            ? " — 약품 거래/처방 문서가 아닙니다."
            : " 표가 또렷하게 보이는 이미지로 다시 시도해 주세요."}
        </p>
      ) : (
        <>
          <p className="demo-note">
            추출 {items.length}건 · {dot.GREEN} {byStatus.green} · {dot.YELLOW} {byStatus.yellow} · {dot.RED} {byStatus.red}
            {(summary.needsReview ?? 0) > 0 && <> · <b style={{ color: "#b45309" }}>확인 필요 {summary.needsReview}건</b></>}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th>약품코드</th><th>약품명</th><th>수량</th><th>일수</th><th>총처방량</th><th>단가</th><th>총금액</th><th>단가검증</th><th>상태</th></tr></thead>
              <tbody>
                {items.map((r, i) => (
                  <tr key={i} style={r.needsReview ? { background: "#fffbeb" } : undefined} title={(r.review ?? []).join("; ")}>
                    <td className="mono">{r.drugCode ?? "—"}{r.codeInMaster === false ? " ⚠︎" : ""}</td>
                    <td>{r.drugName ?? "—"}</td>
                    <td>{r.quantity ?? "—"}</td>
                    <td>{r.days ?? "—"}</td>
                    <td>{r.prescribedQty ?? "—"}</td>
                    <td>{r.unitPrice ?? "—"}</td>
                    <td>{r.totalAmount ?? "—"}</td>
                    <td style={{ fontSize: 12, color: r.priceCheck === "mismatch" ? "#b91c1c" : r.priceCheck === "historical" ? "#b45309" : "#64748b" }}>{priceLabel[r.priceCheck ?? "none"]}</td>
                    <td>{dot[r.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={downloadCsv}>CSV 다운로드</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            ⚠︎ = 마스터 미조회 코드(약품명으로 확인) · 노란 행 = 사용자 확인 권장 · 값은 이미지에서 읽은 원본(OCR)
          </p>
        </>
      )}
    </>
  );
}
