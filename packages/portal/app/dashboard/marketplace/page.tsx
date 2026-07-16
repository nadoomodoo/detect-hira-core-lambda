import Link from "next/link";
import { prisma } from "@platform/db";
import { StatusBadge, PRODUCT_STATUS } from "@/components/console/StatusBadge";

export const dynamic = "force-dynamic";
const UNIT: Record<string, string> = { CALL: "호출", IMAGE: "이미지", PAGE: "페이지" };

export default async function DashboardMarketplace() {
  const products = await prisma.product.findMany({ where: { status: { not: "DEPRECATED" } }, orderBy: { name: "asc" } });

  // 카테고리별 그룹
  const byCat = new Map<string, typeof products>();
  for (const p of products) {
    const c = p.category ?? "기타";
    (byCat.get(c) ?? byCat.set(c, []).get(c)!).push(p);
  }

  return (
    <>
      <div className="page-header"><div><h1>마켓플레이스</h1><p className="purpose">지금 호출할 수 있는 모든 API예요. API 키 하나로 바로 사용하세요.</p></div></div>

      {products.length === 0 ? (
        <div className="collection"><div className="empty-state"><h3>제공 중인 API가 없습니다</h3></div></div>
      ) : (
        [...byCat.entries()].map(([cat, list]) => (
          <section key={cat} style={{ marginBottom: 28 }}>
            <div className="section-title" style={{ fontSize: 15, margin: "0 0 12px" }}>{cat}</div>
            <div className="catalog">
              {list.map((p) => (
                <div className="card" key={p.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
                    <h3>{p.name}</h3>
                    {p.status !== "ACTIVE" && <StatusBadge kind={(PRODUCT_STATUS[p.status]?.kind ?? "neutral") as any} label={PRODUCT_STATUS[p.status]?.label ?? p.status} />}
                  </div>
                  <p className="desc">{p.description ?? `${p.category ? p.category + " " : ""}REST API`}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                    <span className="price">{p.priceKrw.toLocaleString()}원<span style={{ fontWeight: 500, color: "var(--text-muted)" }}> / {UNIT[p.billingUnit] ?? "호출"}</span></span>
                    <span className="badge">무료 {p.freeQuota}회</span>
                  </div>
                  <Link href={`/docs/api/${p.slug}`} className="btn btn-sm" style={{ width: "100%" }}>자세히 보기</Link>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
