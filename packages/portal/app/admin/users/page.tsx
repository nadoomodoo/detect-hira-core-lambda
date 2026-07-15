import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { topupUser } from "./actions";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => new Date(d).toISOString().slice(0, 10);

export default async function Users() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { credit: true, _count: { select: { apiKeys: true } } },
    take: 200,
  });

  return (
    <>
      <div className="page-header"><div><h1>유저 · 수동 충전</h1><p className="purpose">입금 확인 후 원 단위로 크레딧을 충전합니다.</p></div></div>
      <div className="collection">
        <div className="collection-toolbar"><span className="count"><b>{users.length}</b>명</span></div>
        {users.length === 0 ? (
          <div className="empty-state"><h3>유저가 없습니다</h3></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>이메일</th><th>역할</th><th className="num">잔액(원)</th><th className="num">키</th><th>가입</th><th>충전</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="identity">{u.email}</td>
                  <td>{u.role === "ADMIN" ? <StatusBadge kind="info" label="관리자" /> : <StatusBadge kind="neutral" label="고객" />}</td>
                  <td className="num">{(u.credit?.balanceKrw ?? 0).toLocaleString()}</td>
                  <td className="num">{u._count.apiKeys}</td>
                  <td className="muted">{fmt(u.createdAt)}</td>
                  <td className="row-actions">
                    <form action={topupUser} style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <input type="hidden" name="userId" value={u.id} />
                      <input className="cell-input num" type="number" name="amountKrw" placeholder="금액" step={1000} style={{ width: 96 }} />
                      <input className="cell-input" type="text" name="memo" placeholder="메모" style={{ width: 110 }} />
                      <button className="btn btn-sm" type="submit">충전</button>
                    </form>
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
