"use client";
import { useEffect, useMemo, useState } from "react";
import type { ApiKind } from "@platform/db";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { StatusBadge, PRODUCT_STATUS } from "@/components/console/StatusBadge";
import { DemoWidget } from "@/components/demo/DemoWidget";

const UNIT: Record<string, string> = { CALL: "호출", IMAGE: "이미지", PAGE: "페이지" };

export interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  priceKrw: number;
  freeQuota: number;
  billingUnit: string;
  status: string;
  apiKind: ApiKind;
}

export function MarketplaceCatalog({ products }: { products: CatalogProduct[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("전체");
  const [demo, setDemo] = useState<CatalogProduct | null>(null);

  // 모달 열림 동안 배경 스크롤 잠금 + ESC 닫기
  useEffect(() => {
    if (!demo) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDemo(null); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [demo]);

  // 카테고리 목록 (등장 순서 유지)
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const p of products) {
      const c = p.category ?? "기타";
      if (!seen.includes(c)) seen.push(c);
    }
    return ["전체", ...seen];
  }, [products]);

  // 검색어 + 카테고리 필터
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return products.filter((p) => {
      const c = p.category ?? "기타";
      if (cat !== "전체" && c !== cat) return false;
      if (!kw) return true;
      return (
        p.name.toLowerCase().includes(kw) ||
        (p.description ?? "").toLowerCase().includes(kw) ||
        c.toLowerCase().includes(kw)
      );
    });
  }, [products, q, cat]);

  // 필터 결과를 카테고리별로 그룹
  const groups = useMemo(() => {
    const map = new Map<string, CatalogProduct[]>();
    for (const p of filtered) {
      const c = p.category ?? "기타";
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push(p);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <>
      <div className="mkt-toolbar">
        <div className="mkt-cats">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`mkt-cat${cat === c ? " active" : ""}`}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <input
          className="mkt-search"
          type="search"
          placeholder="API 검색 (이름·설명)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="API 검색"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="collection"><div className="empty-state"><h3>조건에 맞는 API가 없습니다</h3><p className="muted">검색어나 카테고리를 바꿔보세요.</p></div></div>
      ) : (
        groups.map(([c, list]) => (
          <section key={c} style={{ marginBottom: 28 }}>
            <div className="section-title" style={{ fontSize: 15, margin: "0 0 12px" }}>{c}</div>
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
                  <div style={{ display: "flex", gap: 8 }}>
                    <a href={`/docs/api/${p.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-secondary" style={{ flex: 1 }}>자세히 보기</a>
                    <button type="button" className="btn btn-sm" style={{ flex: 1 }} onClick={() => setDemo(p)}>호출해보기</button>
                  </div>
                  <Link href={`/dashboard/apply?product=${p.slug}`} className="mkt-apply-link" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>대량·유료 사용 신청 <ArrowRight size={14} className="arrow" aria-hidden /></Link>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {demo && (
        <div className="modal-overlay" onClick={() => setDemo(null)}>
          <div className="modal-panel" role="dialog" aria-modal="true" aria-label={`${demo.name} 호출해보기`} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>{demo.name}</h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>이미지를 올려 바로 호출해보세요. 무료 제공량 후 잔액에서 차감됩니다.</p>
              </div>
              <button type="button" className="modal-close" aria-label="닫기" onClick={() => setDemo(null)}>×</button>
            </div>
            <div className="modal-body">
              <DemoWidget slug={demo.slug} apiKind={demo.apiKind} loggedIn />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
