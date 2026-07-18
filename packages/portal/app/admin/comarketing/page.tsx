import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Pager } from "@/components/console/Pager";
import { upsertMapping, toggleMapping, deleteMapping, importFile } from "./actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;
const fmt = (d: Date) => new Date(d).toISOString().slice(0, 10);

export default async function Comarketing({
  searchParams,
}: {
  searchParams: Promise<{ imported?: string; error?: string; page?: string }>;
}) {
  const { imported, error, page } = await searchParams;
  const total = await prisma.coMarketingMapping.count();
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const rows = await prisma.coMarketingMapping.findMany({
    orderBy: { updatedAt: "desc" },
    skip: (current - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const qs = (p: number) => `?page=${p}`;

  return (
    <>
      <div className="page-header"><div><h1>코마케팅 매핑</h1><p className="purpose">약가코드의 표기 제약사명을 오버라이드 (전역 적용, 태깅·추출 공통)</p></div></div>
      {imported && <div className="flashbar flashbar-success">{imported}건 반영되었습니다.</div>}
      {error === "nofile" && <div className="flashbar flashbar-error">업로드할 파일을 선택해 주세요.</div>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <form className="form-section stack" action={upsertMapping} style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ fontWeight: 700 }}>단건 추가/수정</h3>
          <div className="field"><label>약가코드 (9자리)</label><input name="drugCode" pattern="\d{9}" required /></div>
          <div className="field"><label>표기 제약사명</label><input name="displayName" required /></div>
          <div className="field"><label>원 제약사명 (선택)</label><input name="originalName" /></div>
          <button className="btn btn-sm" type="submit">저장</button>
        </form>

        <form className="form-section stack" action={importFile} style={{ flex: 1, minWidth: 300 }}>
          <h3 style={{ fontWeight: 700 }}>엑셀 벌크 업로드</h3>
          <p className="muted">양식을 내려받아 <code>약가코드 · 표기 제약사명 · 원 제약사명(선택)</code>을 채운 뒤 업로드하세요. 기존 코드는 갱신됩니다.</p>
          <a className="btn btn-sm btn-secondary" href="/admin/comarketing/template" style={{ alignSelf: "flex-start" }}>엑셀 양식 다운로드</a>
          <div className="field"><label>엑셀/CSV 파일</label><input type="file" name="file" accept=".xlsx,.csv" required /></div>
          <button className="btn btn-sm" type="submit">업로드</button>
        </form>
      </div>

      <div className="collection">
        <div className="collection-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="count">총 <b>{total.toLocaleString()}</b>건 · {current}/{pageCount} 페이지</span>
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
        <Pager current={current} pageCount={pageCount} makeHref={qs} />
      </div>
    </>
  );
}
