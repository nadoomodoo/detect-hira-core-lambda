"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function DocsNav({ apis }: { apis: { slug: string; name: string }[] }) {
  const path = usePathname();
  const isDocs = path === "/docs";
  return (
    <nav className="docs-nav">
      <div className="group">시작하기</div>
      <Link href="/docs" className={isDocs ? "active" : ""}>개요</Link>
      <Link href="/docs#auth" className={isDocs ? "" : ""}>인증</Link>
      <Link href="/docs#pricing">과금</Link>
      <Link href="/docs#errors">공통 에러</Link>

      <div className="group">API 레퍼런스</div>
      {apis.map((a) => (
        <Link key={a.slug} href={`/docs/api/${a.slug}`} className={path === `/docs/api/${a.slug}` ? "active" : ""}>
          {a.name}
        </Link>
      ))}
    </nav>
  );
}
