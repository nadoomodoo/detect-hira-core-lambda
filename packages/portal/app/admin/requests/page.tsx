import { prisma } from "@platform/db";
import { StatusBadge, REQ_STATUS } from "@/components/console/StatusBadge";
import { updateRequestStatus } from "./actions";

export const dynamic = "force-dynamic";
const fmt = (d: Date) => new Date(d).toISOString().slice(0, 10);

export default async function Requests() {
  const reqs = await prisma.accessRequest.findMany({ orderBy: { createdAt: "desc" }, include: { user: true }, take: 200 });
  const pids = [...new Set(reqs.map((r) => r.productId))];
  const products = pids.length ? await prisma.product.findMany({ where: { id: { in: pids } } }) : [];
  const pmap = new Map(products.map((p) => [p.id, p.name]));

  return (
    <>
      <div className="page-header"><div><h1>사용 신청</h1><p className="purpose">무료 초과 사용 신청. 연락·입금 후 유저에서 수동 충전하세요.</p></div></div>
      <div className="collection">
        <div className="collection-toolbar"><span className="count"><b>{reqs.length}</b>건</span></div>
        {reqs.length === 0 ? (
          <div className="empty-state"><h3>신청이 없습니다</h3></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>신청일</th><th>유저</th><th>프로덕트</th><th>예상량</th><th>용도</th><th>연락처</th><th>상태</th><th></th></tr></thead>
            <tbody>
              {reqs.map((r) => (
                <tr key={r.id}>
                  <td className="muted mono">{fmt(r.createdAt)}</td>
                  <td className="identity">{r.user.email}</td>
                  <td>{pmap.get(r.productId) ?? r.productId}</td>
                  <td className="muted">{r.expectedVolume ?? "—"}</td>
                  <td className="muted">{r.purpose ?? "—"}</td>
                  <td className="muted">{r.contact}</td>
                  <td>
                    <form id={`r-${r.id}`} action={updateRequestStatus}><input type="hidden" name="id" value={r.id} /></form>
                    <select name="status" form={`r-${r.id}`} defaultValue={r.status} className="cell-select">
                      {Object.entries(REQ_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                  <td className="row-actions"><button className="btn btn-sm" type="submit" form={`r-${r.id}`}>저장</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
