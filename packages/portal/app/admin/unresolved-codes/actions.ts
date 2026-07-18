"use server";
import { prisma } from "@platform/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

async function admin() {
  const s = await auth();
  if ((s?.user as any)?.role !== "ADMIN") throw new Error("forbidden");
}

/** 해결됨/미해결 토글. */
export async function toggleResolved(fd: FormData): Promise<void> {
  await admin();
  const drugCode = String(fd.get("drugCode") ?? "");
  const resolved = fd.get("resolved") === "true";
  if (!drugCode) return;
  await prisma.unresolvedDrugCode.update({ where: { drugCode }, data: { resolved: !resolved } }).catch(() => {});
  revalidatePath("/admin/unresolved-codes");
}

/** 마스터에 추가(9자리 코드 + 제약사명) 후 해당 미조회 로그 해결 처리. */
export async function addToMaster(fd: FormData): Promise<void> {
  await admin();
  const drugCode = String(fd.get("drugCode") ?? "").trim();
  const manufacturerName = String(fd.get("manufacturerName") ?? "").trim();
  const drugName = String(fd.get("drugName") ?? "").trim() || null;
  if (!drugCode || !manufacturerName) redirect("/admin/unresolved-codes?error=need");
  await prisma.drugMaster.upsert({
    where: { drugCode },
    create: { drugCode, manufacturerName, drugName, source: "admin" },
    update: { manufacturerName, drugName, source: "admin" },
  });
  await prisma.unresolvedDrugCode.update({ where: { drugCode }, data: { resolved: true } }).catch(() => {});
  revalidatePath("/admin/unresolved-codes");
  revalidatePath("/admin/master");
  redirect("/admin/unresolved-codes?added=" + encodeURIComponent(drugCode));
}

/** 로그 삭제(정리용). */
export async function deleteUnresolved(fd: FormData): Promise<void> {
  await admin();
  const drugCode = String(fd.get("drugCode") ?? "");
  if (drugCode) await prisma.unresolvedDrugCode.delete({ where: { drugCode } }).catch(() => {});
  revalidatePath("/admin/unresolved-codes");
}
