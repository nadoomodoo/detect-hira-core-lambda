"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@platform/db";

/** 수동 충전 — 입금 확인 후 어드민이 원 단위 충전 (CreditTx TOPUP + 잔액 증가). */
export async function topupUser(fd: FormData) {
  const session = await auth();
  const adminId = (session?.user as any)?.id as string | undefined;
  if ((session?.user as any)?.role !== "ADMIN") throw new Error("forbidden");

  const userId = String(fd.get("userId") ?? "");
  const amountKrw = Math.trunc(Number(fd.get("amountKrw") ?? 0));
  const memo = String(fd.get("memo") ?? "").trim() || null;
  if (!userId || amountKrw === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.creditAccount.upsert({
      where: { userId },
      create: { userId, balanceKrw: amountKrw },
      update: { balanceKrw: { increment: amountKrw } },
    });
    await tx.creditTx.create({
      data: { userId, deltaKrw: amountKrw, type: "TOPUP", memo, adminId },
    });
  });
  revalidatePath("/admin/users");
}
