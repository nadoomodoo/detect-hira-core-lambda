"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@platform/db";

/**
 * 충전 요청 확정 — 입금 확인 후 어드민이 실행.
 * chargeKrw(부가세 제외 순액)를 잔액에 원자적으로 충전하고 요청을 confirmed 로 마감.
 */
export async function confirmTopUp(fd: FormData) {
  const session = await auth();
  const adminId = (session?.user as any)?.id as string | undefined;
  if ((session?.user as any)?.role !== "ADMIN") throw new Error("forbidden");

  const id = String(fd.get("id") ?? "");
  const req = await prisma.topUpRequest.findUnique({ where: { id } });
  if (!req || req.status !== "pending") redirect("/admin/topups?error=state");

  await prisma.$transaction(async (tx) => {
    // 동시 확정 방지: pending → confirmed 로 조건부 전이(이미 처리됐으면 0건)
    const claimed = await tx.topUpRequest.updateMany({
      where: { id, status: "pending" },
      data: { status: "confirmed", confirmedAt: new Date(), confirmedBy: adminId },
    });
    if (claimed.count === 0) throw new Error("already_processed");

    await tx.creditAccount.upsert({ where: { userId: req.userId }, create: { userId: req.userId, balanceKrw: 0 }, update: {} });
    await tx.creditAccount.update({ where: { userId: req.userId }, data: { balanceKrw: { increment: req.chargeKrw } } });
    await tx.creditTx.create({
      data: {
        userId: req.userId,
        deltaKrw: req.chargeKrw,
        type: "TOPUP",
        memo: `무통장 입금 ${req.depositKrw.toLocaleString()}원 (부가세 ${req.vatKrw.toLocaleString()}원 제외)`,
        adminId,
      },
    });
  });

  revalidatePath("/admin/topups");
  redirect("/admin/topups?ok=confirmed");
}

/** 충전 요청 반려/취소 — 입금이 확인되지 않은 요청 정리. */
export async function rejectTopUp(fd: FormData) {
  const session = await auth();
  if ((session?.user as any)?.role !== "ADMIN") throw new Error("forbidden");
  const id = String(fd.get("id") ?? "");
  await prisma.topUpRequest.updateMany({ where: { id, status: "pending" }, data: { status: "canceled" } });
  revalidatePath("/admin/topups");
  redirect("/admin/topups?ok=rejected");
}
