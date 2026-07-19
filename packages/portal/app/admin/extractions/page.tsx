import { AlertTriangle, RotateCw } from "lucide-react";
import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Pager } from "@/components/console/Pager";
import { fmtKST } from "@/lib/datetime";

/**
 * 추출 검수(HITL) — 항목별 신호등과 "사용자 확인 필요" 행을 검토.
 * 9자리 표준코드가 아닌 내부코드/미조회/산술불일치 행이 confirm 대상으로 노출된다.
 */
export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;
const fmt = fmtKST;

const docTypeLabel: Record<string, string> = {
  drug_table: "약품 표",
  business_registration: "사업자등록증",
  prescription: "처방전",
  receipt: "영수증",
  other: "기타",
  unknown: "—",
};

// 단가 검증 상태(SCD2 대조 — OCR 값은 정본, 마스터는 검증용)
const priceLabel: Record<string, string> = {
  current: "현재가 일치",
  historical: "과거가 일치(변동)",
  mismatch: "불일치",
  none: "—",
};

function lightBadge(t: string) {
  if (t === "GREEN") return <StatusBadge kind="success" label="GREEN" />;
  if (t === "YELLOW") return <StatusBadge kind="warning" label="YELLOW" />;
  return <StatusBadge kind="error" label="RED" />;
}

export default async function ExtractionsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; review?: string; page?: string }>;
}) {
  const { id, review, page } = await searchParams;
  const onlyReview = review === "1";

  // 상세 보기
  if (id) {
    const ex = await prisma.ediExtraction.findUnique({ where: { id }, include: { rows: { orderBy: { rowIndex: "asc" } } } });
    if (!ex) return <div className="empty-state"><h3>추출을 찾을 수 없습니다</h3></div>;
    return (
      <>
        <div className="page-header"><div><h1>추출 상세</h1><p className="purpose muted mono">{ex.requestId}</p></div><a className="btn btn-sm btn-secondary" href="/admin/extractions">← 목록</a></div>
        <div className="form-section" style={{ marginBottom: 16 }}>
          <p>템플릿: <b>{ex.templateKey ?? "—"}</b> v{ex.templateVersion ?? "—"} · 표검출: {ex.foundTable ? "예" : "아니오"} · 문서유형: <b>{docTypeLabel[ex.documentType ?? "unknown"] ?? ex.documentType}</b> · 회전: {(ex.cropMeta as any)?.applied_rotation ?? 0}° · 크롭: {(ex.cropMeta as any)?.fallback ? "원본(폴백)" : "크롭됨"} · {fmt(ex.createdAt)}</p>
          {(() => {
            const iq = ex.imageQuality as { readable?: boolean; issues?: string[]; note?: string } | null;
            if (!iq || (iq.readable !== false && !(iq.issues && iq.issues.length))) return null;
            return <p style={{ color: "#991b1b", marginTop: 4 }}><AlertTriangle size={14} style={{ verticalAlign: "-2px" }} aria-hidden /> 이미지 품질{iq.readable === false ? " 읽기 어려움" : ""}{iq.issues && iq.issues.length ? `: ${iq.issues.join(", ")}` : ""}{iq.note ? ` — ${iq.note}` : ""}</p>;
          })()}
        </div>
        <div className="collection">
          <div className="collection-toolbar"><span className="count"><b>{ex.rows.length}</b>행</span></div>
          <table className="tbl">
            <thead><tr><th>#</th><th>약품코드</th><th>형식</th><th>약품명</th><th>수량</th><th>일수</th><th>총처방량</th><th>단가</th><th>총금액</th><th>단가검증</th><th>신호등</th><th>확인필요</th><th>사유</th></tr></thead>
            <tbody>
              {ex.rows.map((r) => (
                <tr key={r.id} style={r.needsReview ? { background: "#fffbeb" } : undefined}>
                  <td>{r.rowIndex}</td>
                  <td className="mono">{r.drugCode ?? "—"}{r.recropPass ? <> <RotateCw size={12} color="#64748b" style={{ verticalAlign: "-2px" }} aria-label="재크롭 통과" /></> : ""}</td>
                  <td className="muted">{r.codeType}</td>
                  <td>{r.drugName ?? "—"}</td>
                  <td>{r.quantity ?? "—"}</td>
                  <td>{r.days ?? "—"}</td>
                  <td>{r.prescribedQty ?? "—"}</td>
                  <td>{r.unitPrice ?? "—"}</td>
                  <td>{r.totalAmount ?? "—"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{priceLabel[r.priceStatus ?? "none"]}</td>
                  <td>{lightBadge(r.trafficLight)}</td>
                  <td>{r.needsReview ? <AlertTriangle size={13} color="#b45309" style={{ verticalAlign: "-2px" }} aria-label="확인 필요" /> : ""}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{(r.reviewFlags as string[] | null)?.join("; ") ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  // 목록
  const where = onlyReview ? { rows: { some: { needsReview: true } } } : {};
  const total = await prisma.ediExtraction.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const list = await prisma.ediExtraction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (current - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { rows: { select: { trafficLight: true, needsReview: true } } },
  });
  const qs = (p: number) => `?page=${p}${onlyReview ? "&review=1" : ""}`;

  return (
    <>
      <div className="page-header"><div><h1>추출 검수 (HITL)</h1><p className="purpose">항목별 신호등과 사용자 확인 필요 행(9자리 아닌 코드·미조회·산술불일치)을 검토합니다.</p></div></div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <a className={`btn btn-sm ${onlyReview ? "btn-secondary" : ""}`} href="/admin/extractions">전체</a>
        <a className={`btn btn-sm ${onlyReview ? "" : "btn-secondary"}`} href="/admin/extractions?review=1">확인 필요만</a>
      </div>
      <div className="collection">
        <div className="collection-toolbar"><span className="count">총 <b>{total.toLocaleString()}</b>건 · {current}/{pageCount} 페이지</span></div>
        {list.length === 0 ? (
          <div className="empty-state"><h3>추출 내역이 없습니다</h3></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>생성</th><th>requestId</th><th>문서유형</th><th>행</th><th>G/Y/R</th><th>확인필요</th><th></th></tr></thead>
            <tbody>
              {list.map((ex) => {
                const g = ex.rows.filter((r) => r.trafficLight === "GREEN").length;
                const y = ex.rows.filter((r) => r.trafficLight === "YELLOW").length;
                const rr = ex.rows.filter((r) => r.trafficLight === "RED").length;
                const nr = ex.rows.filter((r) => r.needsReview).length;
                return (
                  <tr key={ex.id}>
                    <td className="muted">{fmt(ex.createdAt)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{ex.requestId.slice(0, 18)}…</td>
                    <td className={ex.foundTable ? "" : "muted"} style={{ fontSize: 12 }}>{docTypeLabel[ex.documentType ?? "unknown"] ?? ex.documentType}</td>
                    <td>{ex.rows.length}</td>
                    <td className="mono">{g}/{y}/{rr}</td>
                    <td>{nr > 0 ? <span style={{ color: "#b45309", fontWeight: 700 }}>{nr}</span> : "—"}</td>
                    <td style={{ textAlign: "right" }}><a className="btn btn-sm btn-secondary" href={`/admin/extractions?id=${ex.id}`}>상세</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pager current={current} pageCount={pageCount} makeHref={qs} />
      </div>
    </>
  );
}
