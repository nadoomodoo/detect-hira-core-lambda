"use client";
import { Circle, AlertTriangle } from "lucide-react";
import type { ResultViewProps } from "../types";
import { downloadBlob, openImageInNewTab } from "../download";
import { ResultDataGrid, type GridColSpec } from "./grid/ResultDataGrid";

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

const statusColor: Record<string, string> = { GREEN: "#16a34a", YELLOW: "#eab308", RED: "#dc2626" };
function StatusDot({ status }: { status: string }) {
  return <Circle size={12} fill={statusColor[status] ?? "#94a3b8"} stroke="none" style={{ verticalAlign: "middle" }} aria-label={status} />;
}
function WarnIcon({ size = 14 }: { size?: number }) {
  return <AlertTriangle size={size} color="currentColor" style={{ verticalAlign: "-2px", flexShrink: 0 }} aria-hidden />;
}
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

  // 그리드 컬럼(복사 시 헤더/열 순서와 동일) — 숫자 컬럼은 우측정렬·천단위.
  const gridColumns: GridColSpec[] = [
    { title: "약품코드", width: 120 },
    { title: "약품명", width: 220 },
    { title: "수량", numeric: true, width: 72 },
    { title: "일수", numeric: true, width: 64 },
    { title: "총처방량", numeric: true, width: 90 },
    { title: "단가", numeric: true, width: 84 },
    { title: "총금액", numeric: true, width: 104 },
    { title: "마스터", width: 72 },
    { title: "단가검증", width: 112 },
    { title: "상태", width: 76 },
    { title: "확인필요", width: 76 },
    { title: "사유", width: 260 },
  ];
  const gridData: (string | number | null)[][] = items.map((r) => [
    r.drugCode ?? "",
    r.drugName ?? "",
    r.quantity,
    r.days,
    r.prescribedQty,
    r.unitPrice,
    r.totalAmount,
    r.codeInMaster === false ? "미조회" : r.codeInMaster ? "O" : "—",
    priceLabel[r.priceCheck ?? "none"],
    r.status,
    r.needsReview ? "확인" : "",
    (r.review ?? []).join("; "),
  ]);

  function downloadCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = gridData.map((row) => row.map((v) => (v == null ? "" : v)));
    downloadBlob(
      `${base}_추출.csv`,
      new Blob(["﻿" + [gridColumns.map((c) => c.title), ...body].map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }),
    );
  }

  async function copyTsv() {
    const rows = [gridColumns.map((c) => c.title), ...gridData.map((row) => row.map((v) => (v == null ? "" : String(v))))];
    const tsv = rows.map((r) => r.join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
    } catch {
      /* 클립보드 권한 없음 — 그리드에서 범위선택 후 Ctrl/Cmd+C 사용 */
    }
  }

  return (
    <>
      <div className="demo-images demo-images-single">
        {preview && <figure><figcaption className="muted">원본 (클릭하면 크게 보기)</figcaption><img src={preview} alt="원본" style={{ cursor: "zoom-in" }} onClick={() => openImageInNewTab(preview)} /></figure>}
      </div>

      {(meta.imageReadable === false || (meta.imageIssues && meta.imageIssues.length > 0)) && (
        <p className="demo-note" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>
          <WarnIcon /> 이미지 품질 문제{meta.imageReadable === false ? "(읽기 어려움 — 재촬영 권장)" : ""}
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
            추출 {items.length}건 · <StatusDot status="GREEN" /> {byStatus.green} · <StatusDot status="YELLOW" /> {byStatus.yellow} · <StatusDot status="RED" /> {byStatus.red}
            {(summary.needsReview ?? 0) > 0 && <> · <b style={{ color: "#b45309" }}>확인 필요 {summary.needsReview}건</b></>}
          </p>
          <ResultDataGrid columns={gridColumns} data={gridData} />
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" onClick={copyTsv}>표 전체 복사</button>
            <button className="btn btn-sm btn-secondary" onClick={downloadCsv}>CSV 다운로드</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            표에서 셀 범위를 끌어 선택하고 Ctrl/⌘+C 로 복사하거나 <b>표 전체 복사</b>로 엑셀에 붙여넣으세요. · “미조회” = 마스터에 없는 코드(약품명으로 확인) · 값은 이미지에서 읽은 원본(OCR)
          </p>
        </>
      )}
    </>
  );
}
