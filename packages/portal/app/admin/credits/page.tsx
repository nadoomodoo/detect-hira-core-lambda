import { prisma, Prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";

export const dynamic = "force-dynamic";
const fmt = (d: Date) => new Date(d).toISOString().slice(0, 16).replace("T", " ");

const TYPE: Record<string, { kind: "success" | "info" | "neutral" | "warning"; label: string }> = {
  TOPUP: { kind: "info", label: "충전" },
  CHARGE: { kind: "neutral", label: "과금" },
  REFUND: { kind: "warning", label: "환불" },
};

export default async function Credits({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const typeFilter = type && TYPE[type] ? (type as Prisma.EnumTxTypeFilter["equals"]) : undefined;

  const rows = await prisma.creditTx.findMany({
    where: typeFilter ? { type: typeFilter } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { email: true } } },
  });
  const productIds = [...new Set(rows.map((r) => r.productId).filter((x): x is string => !!x))];
  const products = productIds.length ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }) : [];
  const pname = new Map(products.map((p) => [p.id, p.name]));
  // 처리자(adminId) → 이메일 매핑
  const adminIds = [...new Set(rows.map((r) => r.adminId).filter((x): x is string => !!x))];
  const admins = adminIds.length ? await prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true } }) : [];
  const aname = new Map(admins.map((a) => [a.id, a.email]));

  return (
    <>
      <div className="page-header"><div><h1>거래 원장</h1><p className="purpose">잔액 충전·과금·환불 전체 이력 (감사용, 절대시각·최근 200건)</p></div></div>

      <div className="collection">
        <div className="collection-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span className="count"><b>{rows.length}</b>건{type ? ` · ${TYPE[type]?.label ?? type}` : ""}</span>
          <form method="get" style={{ display: "flex", gap: 8 }}>
            <select name="type" defaultValue={type ?? ""} className="cell-select">
              <option value="">전체 유형</option>
              {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button className="btn btn-sm btn-secondary" type="submit">필터</button>
          </form>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state"><h3>거래 내역이 없습니다</h3></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>시각</th><th>유저</th><th>유형</th><th className="num">금액(원)</th><th>제품</th><th className="num">단가</th><th>처리자</th><th>메모</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(r.createdAt)}</td>
                  <td className="identity">{r.user?.email ?? r.userId}</td>
                  <td><StatusBadge kind={(TYPE[r.type] ?? TYPE.CHARGE).kind} label={(TYPE[r.type] ?? TYPE.CHARGE).label} /></td>
                  <td className="num" style={{ fontVariantNumeric: "tabular-nums", color: r.deltaKrw < 0 ? "#b91c1c" : "#047857", fontWeight: 700 }}>
                    {r.deltaKrw > 0 ? "+" : ""}{r.deltaKrw.toLocaleString()}
                  </td>
                  <td className="muted">{r.productId ? (pname.get(r.productId) ?? r.productId) : "—"}</td>
                  <td className="num muted" style={{ fontVariantNumeric: "tabular-nums" }}>{r.unitPriceKrw != null ? r.unitPriceKrw.toLocaleString() : "—"}</td>
                  <td className="muted">{r.adminId ? (aname.get(r.adminId) ?? r.adminId) : "—"}</td>
                  <td className="muted">{r.memo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted" style={{ marginTop: 16 }}>수동 충전은 <a href="/admin/users">유저·충전</a>에서 처리합니다. 이 원장은 조회 전용입니다.</p>
    </>
  );
}
