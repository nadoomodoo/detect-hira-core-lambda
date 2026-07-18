import { NextResponse } from "next/server";
import { prisma } from "@platform/db";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 배치 Job 진행률 폴링 — 본인 소유만. 포털이 DB 를 직접 읽어 게이트웨이 왕복 없이 응답. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "login_required" }, { status: 401 });

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id }, include: { items: { orderBy: { idx: "asc" } } } });
  if (!job || job.userId !== userId) return NextResponse.json({ error: "not_found", message: "작업을 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    failed: job.failed,
    trafficLights: { green: job.greenCount, yellow: job.yellowCount, red: job.redCount },
    totalCostKrw: job.items.reduce((s, i) => s + (i.costKrw ?? 0), 0),
    items: job.items.map((i) => {
      const r = (i.result as any) ?? {};
      return {
        index: i.idx,
        status: i.status,
        attempts: i.attempts,
        error: i.error ?? undefined,
        extractionId: r.extractionId as string | undefined,
        foundTable: r.foundTable as boolean | undefined,
        itemCount: r.itemCount as number | undefined,
        byStatus: r.byStatus as { green: number; yellow: number; red: number } | undefined,
      };
    }),
  });
}
