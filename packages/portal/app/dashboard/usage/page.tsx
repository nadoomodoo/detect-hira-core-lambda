import { auth } from "@/auth";
import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => new Date(d).toISOString().replace("T", " ").slice(0, 16);

export default async function Usage() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const charges = userId
    ? await prisma.creditTx.findMany({ where: { userId, type: "CHARGE" }, orderBy: { createdAt: "desc" }, take: 200 })
    : [];
  const productIds = [...new Set(charges.map((c) => c.productId).filter(Boolean) as string[])];
  const products = productIds.length ? await prisma.product.findMany({ where: { id: { in: productIds } } }) : [];
  const pmap = new Map(products.map((p) => [p.id, p.name]));

  const total = charges.reduce((s, c) => s + (c.unitPriceKrw ?? 0), 0);

  return (
    <>
      <div className="page-header"><div><h1>호출 이력</h1><p className="purpose">API 호출 건별 내역과 비용</p></div></div>

      <div className="summary">
        <div className="metric"><div className="label">총 호출</div><div className="value">{charges.length}</div></div>
        <div className="metric"><div className="label">누적 과금</div><div className="value">{total.toLocaleString()}원</div></div>
      </div>

      <div className="collection">
        <div className="collection-toolbar"><span className="count"><b>{charges.length}</b>건 (최근 200)</span></div>
        {charges.length === 0 ? (
          <div className="empty-state"><h3>호출 내역이 없습니다</h3><p>API 키로 첫 호출을 해보세요.</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>시각</th><th>프로덕트</th><th>구분</th><th className="num">비용(원)</th></tr></thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id}>
                  <td className="muted mono">{fmt(c.createdAt)}</td>
                  <td>{c.productId ? pmap.get(c.productId) ?? c.productId : "—"}</td>
                  <td>{(c.unitPriceKrw ?? 0) === 0 ? <StatusBadge kind="info" label="무료" /> : <StatusBadge kind="neutral" label="유료" />}</td>
                  <td className="num">{(c.unitPriceKrw ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
