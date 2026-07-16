"use server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@platform/db";
import { hashPassword, verifyPassword } from "@/lib/password";

/** 비밀번호 변경 — 현재 비밀번호 확인 후 변경. */
export async function changePassword(fd: FormData) {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) redirect("/login");

  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  const confirm = String(fd.get("confirm") ?? "");

  if (next.length < 8) redirect("/dashboard/account?error=short");
  if (next !== confirm) redirect("/dashboard/account?error=mismatch");

  const u = await prisma.user.findUnique({ where: { id: userId! }, select: { passwordHash: true } });
  // Google(어드민) 계정 등 비밀번호가 없는 경우
  if (!u?.passwordHash) redirect("/dashboard/account?error=nopw");
  if (!verifyPassword(current, u.passwordHash)) redirect("/dashboard/account?error=current");

  await prisma.user.update({ where: { id: userId! }, data: { passwordHash: hashPassword(next) } });
  redirect("/dashboard/account?ok=1");
}
