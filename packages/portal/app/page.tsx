import Link from "next/link";
import { prisma } from "@platform/db";
import { API_BASE, SITE_TAGLINE, endpointPath } from "@/lib/config";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

export const dynamic = "force-dynamic";

const UNIT_LABEL: Record<string, string> = { CALL: "호출", IMAGE: "이미지", PAGE: "페이지" };

export default async function Home() {
  let products: Awaited<ReturnType<typeof prisma.product.findMany>> = [];
  try {
    products = await prisma.product.findMany({ where: { status: { not: "DEPRECATED" } }, orderBy: { name: "asc" } });
  } catch (e) { console.error("LANDING_DB_ERR", e); }

  const byCategory = new Map<string, typeof products>();
  for (const p of products) {
    const c = p.category ?? "기타";
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c)!.push(p);
  }

  return (
    <>
      <PublicHeader />
      <main className="container">
        <section className="hero">
          <h1>{SITE_TAGLINE}</h1>
          <p>분야별 실무 API를 한 곳에서. API 키 하나로 바로 호출하세요.</p>
          <div className="hero-cta">
            <Link href="/signup" className="btn">무료로 시작</Link>
            <Link href="/docs" className="btn btn-secondary">문서 보기</Link>
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">작동 방식</h2>
          <div className="steps">
            <div className="step"><span className="n">1</span><h3>가입</h3><p>이메일로 가입하고 대시보드에 접속합니다.</p></div>
            <div className="step"><span className="n">2</span><h3>API 키 발급</h3><p>대시보드에서 키를 발급받습니다. API별 무료 제공량이 포함됩니다.</p></div>
            <div className="step"><span className="n">3</span><h3>호출</h3><p><code>x-api-key</code> 헤더로 REST 호출. 성공 건당 과금됩니다.</p></div>
          </div>
        </section>

        {products.length === 0 ? (
          <section className="section"><h2 className="section-title">API 카탈로그</h2><p className="muted">등록된 API가 없습니다.</p></section>
        ) : (
          [...byCategory.entries()].map(([cat, items]) => (
            <section key={cat} className="section">
              <h2 className="section-title">{cat}</h2>
              <div className="catalog">
                {items.map((p) => (
                  <div key={p.id} className="card">
                    <h3>{p.name}</h3>
                    <p className="desc" title={p.description ?? undefined}>{p.description ?? "실무용 API"}</p>
                    <p className="muted" style={{ fontSize: 12.5, fontFamily: "ui-monospace, monospace", wordBreak: "break-all", marginBottom: 12 }}>{API_BASE}/api/v1/{p.slug}/{endpointPath(p.apiKind)}</p>
                    <div className="kv"><span className="k">가격</span><span className="price">{p.priceKrw.toLocaleString()}원 / {UNIT_LABEL[p.billingUnit] ?? "호출"}</span></div>
                    <div style={{ margin: "12px 0" }}><span className="badge">무료 {p.freeQuota}회</span></div>
                    <div className="card-actions">
                      <Link href={`/docs/api/${p.slug}`} className="btn btn-secondary" style={{ flex: 1 }}>상세보기</Link>
                      <Link href="/signup" className="btn" style={{ flex: 1 }}>시작하기</Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}

        <section className="section">
          <h2 className="section-title">개발자 친화적</h2>
          <p className="muted" style={{ marginBottom: 12 }}>REST + JSON. 각 API 상세 페이지에서 요청/응답 스펙과 OpenAPI(Swagger/Postman 임포트용)를 제공합니다.</p>
          <pre style={{ background: "#0f172a", color: "#e2e8f0", borderRadius: 10, padding: "16px 18px", overflowX: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13.5, lineHeight: 1.6 }}>
{`curl -X POST ${API_BASE}/api/v1/hira-detect/detect \\
  -H "x-api-key: pk_live_xxxxxxxx" \\
  -H "Content-Type: image/jpeg" \\
  --data-binary @처방전.jpg`}
          </pre>
        </section>

        <section className="section">
          <div className="cta-band">
            <h2>지금 무료로 시작하세요</h2>
            <p>가입 후 바로 API 키를 발급받아 테스트할 수 있습니다.</p>
            <Link href="/signup" className="btn">무료 시작</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
