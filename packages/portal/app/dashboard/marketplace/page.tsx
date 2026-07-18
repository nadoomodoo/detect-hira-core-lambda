import { prisma } from "@platform/db";
import { MarketplaceCatalog, type CatalogProduct } from "./MarketplaceCatalog";

export const dynamic = "force-dynamic";

export default async function DashboardMarketplace() {
  const rows = await prisma.product.findMany({
    where: { status: { not: "DEPRECATED" } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, slug: true, name: true, category: true, description: true, priceKrw: true, freeQuota: true, billingUnit: true, status: true, apiKind: true },
  });
  const products: CatalogProduct[] = rows;

  return (
    <>
      <div className="page-header"><div><h1>마켓플레이스</h1><p className="purpose">지금 호출할 수 있는 모든 API예요. API 키 하나로 바로 사용하세요.</p></div></div>
      {products.length === 0 ? (
        <div className="collection"><div className="empty-state"><h3>제공 중인 API가 없습니다</h3></div></div>
      ) : (
        <MarketplaceCatalog products={products} />
      )}
    </>
  );
}
