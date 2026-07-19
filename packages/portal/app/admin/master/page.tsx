import { prisma, Prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Pager } from "@/components/console/Pager";
import { upsertDrug, deleteDrug, importDrugCsv } from "./actions";
import { fmtKSTDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;
const fmt = fmtKSTDate;
const SOURCE: Record<string, { kind: "success" | "info" | "neutral"; label: string }> = {
  admin: { kind: "success", label: "관리자" },
  "hira-api": { kind: "info", label: "약가 API" },
  seed: { kind: "neutral", label: "초기" },
};

export default async function Master({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; imported?: string; skipped?: string; error?: string }>;
}) {
  const { q, page, imported, skipped, error } = await searchParams;
  const query = (q ?? "").trim();

  const where: Prisma.DrugMasterWhereInput = query
    ? /^\d{1,9}$/.test(query)
      ? { drugCode: { startsWith: query } }
      : { manufacturerName: { contains: query, mode: "insensitive" } }
    : {};

  const [total, matched] = await Promise.all([
    prisma.drugMaster.count(),
    prisma.drugMaster.count({ where }),
  ]);
  const pageCount = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const rows = await prisma.drugMaster.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    skip: (current - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const qs = (p: number) => `?page=${p}${query ? `&q=${encodeURIComponent(query)}` : ""}`;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>약가 마스터</h1>
          <p className="purpose">약가코드 → 제약사·의약품 마스터 (검출 조회 기준, 전 {total.toLocaleString()}건)</p>
        </div>
      </div>

      {imported && <div className="flashbar flashbar-success">CSV {Number(imported).toLocaleString()}건 반영{Number(skipped) > 0 ? ` (불량 ${skipped}행 스킵)` : ""}되었습니다.</div>}
      {error === "invalid" && <div className="flashbar flashbar-error">약가코드(9자리)와 제약사명을 확인하세요.</div>}
      {error === "empty" && <div className="flashbar flashbar-error">업로드할 CSV 내용이 없습니다.</div>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <form className="form-section stack" action={upsertDrug} style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ fontWeight: 700 }}>단건 추가/수정</h3>
          <div className="field"><label>약가코드 (9자리)</label><input name="drugCode" pattern="\d{9}" required /></div>
          <div className="field"><label>제약사명</label><input name="manufacturerName" required /></div>
          <div className="field"><label>의약품명 (선택)</label><input name="drugName" /></div>
          <button className="btn btn-sm" type="submit">저장</button>
        </form>

        <form className="form-section stack" action={importDrugCsv} style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ fontWeight: 700 }}>CSV 업로드 (벌크)</h3>
          <p className="muted">각 줄: <code>약가코드,제약사명,의약품명(선택)</code>. 기존 코드는 갱신, 없으면 추가됩니다.</p>
          <div className="field"><label>CSV 파일</label><input type="file" name="file" accept=".csv,text/csv,text/plain" /></div>
          <p className="muted" style={{ fontSize: 13 }}>또는 붙여넣기:</p>
          <textarea name="csv" rows={3} style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 13, padding: 10, border: "1px solid var(--border)", borderRadius: 8 }} placeholder={"658107190,한풍제약 주식회사,아제나정"} />
          <button className="btn btn-sm" type="submit">임포트</button>
        </form>
      </div>

      <div className="collection">
        <div className="collection-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span className="count">총 <b>{matched.toLocaleString()}</b>건{query ? ` · "${query}" 검색` : ""} · {current}/{pageCount} 페이지</span>
          <form method="get" style={{ display: "flex", gap: 8 }}>
            <input name="q" defaultValue={query} placeholder="약가코드 또는 제약사명" className="cell-input" style={{ height: 36, width: 220 }} />
            <button className="btn btn-sm btn-secondary" type="submit">검색</button>
          </form>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state"><h3>결과가 없습니다</h3><p>검색어를 바꾸거나 위에서 추가/업로드하세요.</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>약가코드</th><th>제약사</th><th>의약품</th><th>출처</th><th>수정</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.drugCode}>
                  <td className="mono identity">{r.drugCode}</td>
                  <td>{r.manufacturerName}</td>
                  <td className="muted">{r.drugName ?? "—"}</td>
                  <td><StatusBadge kind={(SOURCE[r.source] ?? SOURCE.seed).kind} label={(SOURCE[r.source] ?? SOURCE.seed).label} /></td>
                  <td className="muted">{fmt(r.updatedAt)}</td>
                  <td className="row-actions">
                    <form action={deleteDrug}><input type="hidden" name="drugCode" value={r.drugCode} /><button className="btn btn-sm btn-danger" type="submit">삭제</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager current={current} pageCount={pageCount} makeHref={qs} />
      </div>
    </>
  );
}
