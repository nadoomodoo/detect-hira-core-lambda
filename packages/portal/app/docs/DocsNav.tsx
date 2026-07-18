"use client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function DocsNav({ apis }: { apis: { slug: string; name: string; category: string | null }[] }) {
  const path = usePathname();
  const isDocs = path === "/docs";

  // 카테고리별 그룹핑 — 카테고리 추가 시 자동으로 새 그룹으로 노출된다.
  const groups: { category: string; items: typeof apis }[] = [];
  for (const a of apis) {
    const category = a.category ?? "기타";
    let g = groups.find((x) => x.category === category);
    if (!g) { g = { category, items: [] }; groups.push(g); }
    g.items.push(a);
  }

  // 접힌 카테고리 집합 — 기본은 모두 펼침. 현재 보는 API가 속한 그룹은 접혀 있어도 펼쳐 보인다.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (cat: string) => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }));

  return (
    <nav className="docs-nav">
      <div className="group">시작하기</div>
      <Link href="/docs" className={isDocs ? "active" : ""}>개요</Link>
      <Link href="/docs#auth" className={isDocs ? "" : ""}>인증</Link>
      <Link href="/docs#pricing">과금</Link>
      <Link href="/docs#errors">공통 에러</Link>

      <div className="group">API 레퍼런스</div>
      {groups.map((g) => {
        const open = !collapsed[g.category];
        return (
          <div key={g.category} className="docs-nav-cat">
            <button
              type="button"
              className="docs-nav-cat-title"
              onClick={() => toggle(g.category)}
              aria-expanded={open}
            >
              <ChevronRight size={12} aria-hidden className={`docs-nav-caret${open ? " open" : ""}`} />
              {g.category}
            </button>
            {open && g.items.map((a) => (
              <Link key={a.slug} href={`/docs/api/${a.slug}`} className={path === `/docs/api/${a.slug}` ? "active" : ""}>
                {a.name}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
