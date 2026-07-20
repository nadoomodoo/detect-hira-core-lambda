import { auth } from "@/auth";
import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Pager } from "@/components/console/Pager";
import { fmtKST } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const fmt = fmtKST;

export default async function Usage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const where = { userId: userId ?? "", type: "CHARGE" as const };

  const [totalCount, sumAgg] = userId
    ? await Promise.all([
        prisma.creditTx.count({ where }),
        prisma.creditTx.aggregate({ where, _sum: { unitPriceKrw: true } }),
      ])
    : [0, { _sum: { unitPriceKrw: 0 } }];

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const charges = userId
    ? await prisma.creditTx.findMany({ where, orderBy: { createdAt: "desc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE })
    : [];

  const productIds = [...new Set(charges.map((c) => c.productId).filter(Boolean) as string[])];
  const products = productIds.length ? await prisma.product.findMany({ where: { id: { in: productIds } } }) : [];
  const pmap = new Map(products.map((p) => [p.id, p.name]));
  const totalSpent = sumAgg._sum.unitPriceKrw ?? 0;
  const qs = (p: number) => `?page=${p}`;

  return (
    <>
      <div className="page-header"><div><h1>사용량</h1><p className="purpose">내가 호출한 API 내역과 사용 금액이에요.</p></div></div>

      <div className="summary">
        <div className="metric"><div className="label">전체 호출 수</div><div className="value">{totalCount.toLocaleString()}<span style={{ fontSize: 15, fontWeight: 500, color: "var(--text-muted)" }}>건</span></div></div>
        <div className="metric"><div className="label">누적 사용액</div><div className="value">{totalSpent.toLocaleString()}<span style={{ fontSize: 15, fontWeight: 500, color: "var(--text-muted)" }}>원</span></div></div>
      </div>

      <div className="collection">
        <div className="collection-toolbar">
          <span className="count">총 <b>{totalCount.toLocaleString()}</b>건 · {current}/{pageCount} 페이지</span>
        </div>
        {charges.length === 0 ? (
          <div className="empty-state"><h3>아직 호출 내역이 없어요</h3><p>발급한 API 키로 첫 호출을 해보세요. 무료 제공량부터 차감됩니다.</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>일시</th><th>API</th><th>유형</th><th className="num">사용 금액</th></tr></thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id}>
                  <td className="muted">{fmt(c.createdAt)}</td>
                  <td>{c.productId ? pmap.get(c.productId) ?? c.productId : "—"}</td>
                  <td>{(c.unitPriceKrw ?? 0) === 0 ? <StatusBadge kind="info" label="무료 제공" /> : <StatusBadge kind="neutral" label="과금" />}</td>
                  <td className="num">{(c.unitPriceKrw ?? 0) === 0 ? "무료" : `${(c.unitPriceKrw ?? 0).toLocaleString()}원`}</td>
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
