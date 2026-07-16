"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@platform/db";

/**
 * 수동 크레딧 조정 — 입금 확인 후 어드민이 원 단위 충전(양수) 또는 정정(음수).
 * 음수 조정이 잔액을 음수로 만들면 원자적으로 거부(잔액 무결성 보장).
 */
export async function topupUser(fd: FormData) {
  const session = await auth();
  const adminId = (session?.user as any)?.id as string | undefined;
  if ((session?.user as any)?.role !== "ADMIN") throw new Error("forbidden");

  const userId = String(fd.get("userId") ?? "");
  const amountKrw = Math.trunc(Number(fd.get("amountKrw") ?? 0));
  const memo = String(fd.get("memo") ?? "").trim() || null;
  if (!userId || !Number.isFinite(amountKrw) || amountKrw === 0) {
    redirect("/admin/users?error=amount");
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 계정 보장(없으면 잔액 0으로 생성) 후 원자적 가드 업데이트
      await tx.creditAccount.upsert({ where: { userId }, create: { userId, balanceKrw: 0 }, update: {} });
      const updated = await tx.$executeRaw`
        UPDATE "CreditAccount" SET "balanceKrw" = "balanceKrw" + ${amountKrw}
        WHERE "userId" = ${userId} AND "balanceKrw" + ${amountKrw} >= 0`;
      if (updated === 0) throw new Error("would_go_negative");
      await tx.creditTx.create({ data: { userId, deltaKrw: amountKrw, type: "TOPUP", memo, adminId } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "would_go_negative") redirect("/admin/users?error=negative");
    throw e;
  }
  revalidatePath("/admin/users");
  redirect("/admin/users?ok=1");
}
