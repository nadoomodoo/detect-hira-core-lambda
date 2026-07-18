import { NextResponse } from "next/server";
import { prisma } from "@platform/db";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 배치 개별 아이템 상세 — 저장된 EdiExtraction+rows 를 단건 추출과 동일한 items 뷰로 반환(본인 소유만). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });

  const { id } = await params;
  const ext = await prisma.ediExtraction.findUnique({ where: { id }, include: { rows: { orderBy: { rowIndex: "asc" } } } });
  if (!ext || ext.userId !== userId) return NextResponse.json({ error: "not_found", message: "결과를 찾을 수 없습니다." }, { status: 404 });

  const items = ext.rows.map((r) => ({
    drugCode: r.drugCode,
    drugName: r.drugName,
    quantity: r.quantity,
    days: r.days,
    prescribedQty: r.prescribedQty,
    unitPrice: r.unitPrice,
    totalAmount: r.totalAmount,
    codeInMaster: r.codeValid,
    priceCheck: (r.priceStatus ?? "none") as "current" | "historical" | "mismatch" | "none",
    status: r.trafficLight as "GREEN" | "YELLOW" | "RED",
    needsReview: r.needsReview,
    review: (r.reviewFlags as string[] | null) ?? [],
  }));
  const byStatus = { green: 0, yellow: 0, red: 0 };
  for (const r of ext.rows) {
    if (r.trafficLight === "GREEN") byStatus.green++;
    else if (r.trafficLight === "YELLOW") byStatus.yellow++;
    else byStatus.red++;
  }
  const iq = (ext.imageQuality as any) ?? {};
  return NextResponse.json({
    documentType: ext.documentType ?? "unknown",
    foundTable: ext.foundTable,
    items,
    summary: { items: items.length, needsReview: items.filter((i) => i.needsReview).length, byStatus },
    meta: { imageReadable: iq.readable, imageIssues: iq.issues, sourceImageUrl: ext.sourceImageUrl },
  });
}
