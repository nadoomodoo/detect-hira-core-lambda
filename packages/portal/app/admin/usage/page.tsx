import { prisma } from "@platform/db";

export const dynamic = "force-dynamic";

export default async function AdminUsage() {
  // 프로덕트별 정산 (CHARGE 원장 기준 — 스냅샷 가격 합계)
  const grouped = await prisma.creditTx.groupBy({
    by: ["productId"],
    where: { type: "CHARGE" },
    _count: { _all: true },
    _sum: { unitPriceKrw: true },
  });
  const pids = grouped.map((g) => g.productId).filter(Boolean) as string[];
  const products = pids.length ? await prisma.product.findMany({ where: { id: { in: pids } } }) : [];
  const pmap = new Map(products.map((p) => [p.id, p.name]));

  const rows = grouped
    .map((g) => ({ name: g.productId ? pmap.get(g.productId) ?? g.productId : "(미지정)", calls: g._count._all, revenue: g._sum.unitPriceKrw ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0);

  return (
    <>
      <div className="page-header"><div><h1>호출이력 · 정산</h1><p className="purpose">프로덕트별 호출 수·매출 (원장 기준). 상세 감사 로그는 BigQuery.</p></div></div>

      <div className="summary">
        <div className="metric"><div className="label">총 호출</div><div className="value">{totalCalls.toLocaleString()}</div></div>
        <div className="metric"><div className="label">누적 매출</div><div className="value">{totalRev.toLocaleString()}원</div></div>
      </div>

      <div className="collection">
        <div className="collection-toolbar"><span className="count"><b>{rows.length}</b>개 프로덕트</span></div>
        {rows.length === 0 ? (
          <div className="empty-state"><h3>정산 데이터가 없습니다</h3></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>프로덕트</th><th className="num">호출</th><th className="num">매출(원)</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}><td className="identity">{r.name}</td><td className="num">{r.calls.toLocaleString()}</td><td className="num">{r.revenue.toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted" style={{ marginTop: 16 }}>건별 상세(지연·토큰·상태)는 BigQuery <code>platform.api_call_log</code>에 적재됩니다.</p>
    </>
  );
}
