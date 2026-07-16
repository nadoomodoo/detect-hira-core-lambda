import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { upsertMapping, toggleMapping, deleteMapping, importCsv } from "./actions";

export const dynamic = "force-dynamic";
const fmt = (d: Date) => new Date(d).toISOString().slice(0, 10);

export default async function Comarketing({
  searchParams,
}: {
  searchParams: Promise<{ imported?: string }>;
}) {
  const { imported } = await searchParams;
  const rows = await prisma.coMarketingMapping.findMany({ orderBy: { updatedAt: "desc" }, take: 500 });

  return (
    <>
      <div className="page-header"><div><h1>코마케팅 매핑</h1><p className="purpose">약가코드의 표기 제약사명을 오버라이드 (전역 적용, 태깅·추출 공통)</p></div></div>
      {imported && <div className="flashbar flashbar-success">CSV {imported}건 반영되었습니다.</div>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <form className="form-section stack" action={upsertMapping} style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ fontWeight: 700 }}>단건 추가/수정</h3>
          <div className="field"><label>약가코드 (9자리)</label><input name="drugCode" pattern="\d{9}" required /></div>
          <div className="field"><label>표기 제약사명</label><input name="displayName" required /></div>
          <div className="field"><label>원 제약사명 (선택)</label><input name="originalName" /></div>
          <button className="btn btn-sm" type="submit">저장</button>
        </form>

        <form className="form-section stack" action={importCsv} style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ fontWeight: 700 }}>CSV 벌크 임포트</h3>
          <p className="muted">각 줄: <code>약가코드,표기명,원제약사(선택)</code></p>
          <textarea name="csv" rows={5} style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 13, padding: 10, border: "1px solid var(--border)", borderRadius: 8 }} placeholder={"658107190,코마케팅제약,한풍제약"} />
          <button className="btn btn-sm" type="submit">임포트</button>
        </form>
      </div>

      <div className="collection">
        <div className="collection-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="count"><b>{rows.length}</b>건 매핑</span>
          {rows.length > 0 && <a className="btn btn-sm btn-secondary" href="/admin/comarketing/export">CSV 내보내기</a>}
        </div>
        {rows.length === 0 ? (
          <div className="empty-state"><h3>매핑이 없습니다</h3><p>위에서 추가하거나 CSV로 임포트하세요.</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>약가코드</th><th>원 제약사</th><th>표기 제약사</th><th>상태</th><th>수정</th><th></th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="mono identity">{m.drugCode}</td>
                  <td className="muted">{m.originalName ?? "—"}</td>
                  <td>{m.displayName}</td>
                  <td>{m.active ? <StatusBadge kind="success" label="활성" /> : <StatusBadge kind="neutral" label="비활성" />}</td>
                  <td className="muted">{fmt(m.updatedAt)}</td>
                  <td className="row-actions" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <form action={toggleMapping}><input type="hidden" name="id" value={m.id} /><button className="btn btn-sm btn-secondary" type="submit">{m.active ? "비활성" : "활성"}</button></form>
                    <form action={deleteMapping}><input type="hidden" name="id" value={m.id} /><button className="btn btn-sm btn-danger" type="submit">삭제</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
