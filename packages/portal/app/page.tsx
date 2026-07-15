import Link from "next/link";
import { prisma } from "@platform/db";
import { API_BASE } from "@/lib/config";

export const dynamic = "force-dynamic";

const UNIT_LABEL: Record<string, string> = { CALL: "호출", IMAGE: "이미지", PAGE: "페이지" };

export default async function Home() {
  let products: Awaited<ReturnType<typeof prisma.product.findMany>> = [];
  try {
    products = await prisma.product.findMany({
      where: { status: { not: "DEPRECATED" } },
      orderBy: { name: "asc" },
    });
  } catch {
    // DB 미연결(로컬) 시 빈 카탈로그
  }

  return (
    <>
      <nav className="topnav">
        <div className="container">
          <span className="brand">CSO API</span>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Link href="/docs">API 문서</Link>
            <Link href="/login" className="btn btn-secondary">로그인</Link>
          </div>
        </div>
      </nav>
      <main className="container">
        <section className="hero">
          <h1>제약 CSO API 마켓플레이스</h1>
          <p>제약 영업·유통(CSO) 업무에 필요한 API를 한 곳에서. API 키 하나로 바로 호출하세요.</p>
        </section>

        <h2 className="section-title">API 카탈로그</h2>
        {products.length === 0 ? (
          <p className="muted">등록된 API가 없습니다. (로컬에서 DB 미연결 시 비어 보일 수 있습니다.)</p>
        ) : (
          <div className="catalog">
            {products.map((p) => (
              <div key={p.id} className="card">
                <h3>{p.name}</h3>
                <p className="desc">{p.description ?? "제약 CSO 업무용 API"}</p>
                <p className="muted" style={{ fontSize: 12.5, fontFamily: "ui-monospace, monospace", wordBreak: "break-all", marginBottom: 12 }}>{API_BASE}/api/v1/{p.slug}/detect</p>
                <div className="kv"><span className="k">가격</span><span className="price">{p.priceKrw.toLocaleString()}원 / {UNIT_LABEL[p.billingUnit] ?? "호출"}</span></div>
                <div style={{ margin: "12px 0" }}><span className="badge">무료 {p.freeQuota}회</span></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Link href={`/docs/api/${p.slug}`} className="btn btn-secondary" style={{ flex: 1 }}>상세보기</Link>
                  <Link href="/login" className="btn" style={{ flex: 1 }}>시작하기</Link>
                </div>
              </div>
            ))}
          </div>
        )}

      </main>
    </>
  );
}
