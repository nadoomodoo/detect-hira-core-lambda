import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Pager } from "@/components/console/Pager";
import { topupUser } from "./actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;

const fmt = (d: Date) => new Date(d).toISOString().slice(0, 10);

const ERR: Record<string, string> = {
  amount: "충전 금액을 입력하세요(0 불가).",
  negative: "해당 조정은 잔액을 음수로 만들어 거부되었습니다.",
};

export default async function Users({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; page?: string }> }) {
  const { ok, error, page } = await searchParams;
  const total = await prisma.user.count();
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { credit: true, _count: { select: { apiKeys: true } } },
    skip: (current - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const qs = (p: number) => `?page=${p}`;

  return (
    <>
      <div className="page-header"><div><h1>유저 · 수동 충전</h1><p className="purpose">입금 확인 후 원 단위로 잔액을 충전(양수) 또는 정정(음수)합니다.</p></div></div>
      {ok && <div className="flashbar flashbar-success">잔액이 조정되었습니다.</div>}
      {error && <div className="flashbar flashbar-error">{ERR[error] ?? "처리에 실패했습니다."}</div>}
      <div className="collection">
        <div className="collection-toolbar"><span className="count">총 <b>{total.toLocaleString()}</b>명 · {current}/{pageCount} 페이지</span></div>
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
        <Pager current={current} pageCount={pageCount} makeHref={qs} />
      </div>
    </>
  );
}
