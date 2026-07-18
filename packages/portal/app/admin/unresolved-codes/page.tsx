import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { toggleResolved, addToMaster, deleteUnresolved } from "./actions";

/**
 * 미조회 약가코드 — 추출 중 DrugMaster 에 없거나 형식 비표준(내부코드)인 코드.
 * drugCode 단위 dedup(count=관측횟수). 어드민이 마스터에 추가하면 해결 처리.
 */
export const dynamic = "force-dynamic";
const fmt = (d: Date) => new Date(d).toISOString().slice(0, 16).replace("T", " ");
const typeLabel: Record<string, string> = {
  hira: "표준코드(마스터 없음)",
  internal: "내부코드",
  invalid: "형식 불명",
};

export default async function UnresolvedCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; type?: string; added?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const showAll = sp.show === "all";
  const where: any = {};
  if (!showAll) where.resolved = false;
  if (sp.type) where.codeType = sp.type;

  const [rows, pending] = await Promise.all([
    prisma.unresolvedDrugCode.findMany({ where, orderBy: [{ resolved: "asc" }, { count: "desc" }, { lastSeenAt: "desc" }], take: 500 }),
    prisma.unresolvedDrugCode.count({ where: { resolved: false } }),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>미조회 약가코드</h1>
          <p className="purpose">추출 중 마스터에 없거나 형식이 비표준인 코드입니다. 코드 단위로 중복 제거되어 관측 횟수로 집계됩니다. 미해결 {pending}건.</p>
        </div>
      </div>

      {sp.added && <div className="flashbar flashbar-success">{sp.added} 를 마스터에 추가하고 해결 처리했습니다.</div>}
      {sp.error === "need" && <div className="flashbar flashbar-error">약가코드와 제약사명을 입력해 주세요.</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <a className={`btn btn-sm ${showAll ? "btn-secondary" : ""}`} href="/admin/unresolved-codes">미해결만</a>
        <a className={`btn btn-sm ${showAll ? "" : "btn-secondary"}`} href="/admin/unresolved-codes?show=all">전체</a>
        <span style={{ width: 12 }} />
        <a className="btn btn-sm btn-secondary" href="/admin/unresolved-codes?type=hira">표준(마스터없음)</a>
        <a className="btn btn-sm btn-secondary" href="/admin/unresolved-codes?type=internal">내부코드</a>
      </div>

      <div className="collection">
        <div className="collection-toolbar"><span className="count"><b>{rows.length}</b>건</span></div>
        {rows.length === 0 ? (
          <div className="empty-state"><h3>미조회 코드 없음</h3><p>추출 중 마스터에 없는 코드가 나오면 여기에 쌓입니다.</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>약가코드</th><th>형식</th><th>약품명(추출)</th><th>관측</th><th>최근</th><th>상태</th><th>마스터 추가</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.drugCode} style={r.resolved ? { opacity: 0.55 } : undefined}>
                  <td className="mono identity">{r.drugCode}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{typeLabel[r.codeType] ?? r.codeType}</td>
                  <td>{r.drugName ?? "—"}</td>
                  <td>{r.count}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{fmt(r.lastSeenAt)}</td>
                  <td>{r.resolved ? <StatusBadge kind="success" label="해결" /> : <StatusBadge kind="warning" label="미해결" />}</td>
                  <td>
                    <form action={addToMaster} style={{ display: "flex", gap: 4 }}>
                      <input type="hidden" name="drugCode" value={r.drugCode} />
                      <input type="hidden" name="drugName" value={r.drugName ?? ""} />
                      <input name="manufacturerName" placeholder="제약사명" style={{ width: 120, fontSize: 12 }} />
                      <button className="btn btn-sm" type="submit">추가</button>
                    </form>
                  </td>
                  <td className="row-actions" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <form action={toggleResolved}><input type="hidden" name="drugCode" value={r.drugCode} /><input type="hidden" name="resolved" value={String(r.resolved)} /><button className="btn btn-sm btn-secondary" type="submit">{r.resolved ? "미해결로" : "해결표시"}</button></form>
                    <form action={deleteUnresolved}><input type="hidden" name="drugCode" value={r.drugCode} /><button className="btn btn-sm btn-danger" type="submit">삭제</button></form>
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
