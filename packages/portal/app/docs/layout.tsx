import type { ReactNode } from "react";
import { prisma } from "@platform/db";
import { DocsNav } from "./DocsNav";
import { PublicHeader } from "@/components/public/PublicHeader";

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
      <PublicHeader fluid />
      <div className="docs-shell">
        <DocsNav apis={apis} />
        <div className="docs-content">{children}</div>
      </div>
    </>
  );
}
