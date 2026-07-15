import type { ReactNode } from "react";
import Link from "next/link";
import { prisma } from "@platform/db";
import { DocsNav } from "./DocsNav";

export const dynamic = "force-dynamic";

export default async function DocsLayout({ children }: { children: ReactNode }) {
  let apis: { slug: string; name: string }[] = [];
  try {
    apis = await prisma.product.findMany({
      where: { status: { not: "DEPRECATED" } },
      orderBy: { name: "asc" },
      select: { slug: true, name: true },
    });
  } catch { /* DB 미연결 */ }

  return (
    <>
      <nav className="topnav">
        <div className="container">
          <Link href="/" className="brand">CSO API</Link>
          <Link href="/login" className="btn btn-secondary">로그인</Link>
        </div>
      </nav>
      <div className="docs-shell">
        <DocsNav apis={apis} />
        <div className="docs-content">{children}</div>
      </div>
    </>
  );
}
