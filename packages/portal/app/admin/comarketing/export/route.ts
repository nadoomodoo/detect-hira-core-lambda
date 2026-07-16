import { auth } from "@/auth";
import { prisma } from "@platform/db";

export const dynamic = "force-dynamic";

/** 코마케팅 매핑 전체를 CSV로 내보내기 (import 와 동일 컬럼 순서). 어드민 전용. */
export async function GET() {
  const session = await auth();
  if ((session?.user as any)?.role !== "ADMIN") {
    return new Response("forbidden", { status: 403 });
  }

  const rows = await prisma.coMarketingMapping.findMany({ orderBy: { drugCode: "asc" } });
  const esc = (v: string | null) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "drugCode,displayName,originalName,active";
  const body = rows.map((r) => [r.drugCode, esc(r.displayName), esc(r.originalName), r.active ? "1" : "0"].join(",")).join("\n");
  const csv = "﻿" + header + "\n" + body + "\n"; // BOM(엑셀 한글)

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="comarketing-mappings.csv"`,
    },
  });
}
