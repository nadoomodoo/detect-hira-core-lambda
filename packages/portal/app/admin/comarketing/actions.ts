"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@platform/db";

async function admin() {
  const s = await auth();
  if ((s?.user as any)?.role !== "ADMIN") throw new Error("forbidden");
  return s?.user?.email ?? null;
}

/** 단건 추가/수정 (drugCode 기준 upsert). 전역 적용. */
export async function upsertMapping(fd: FormData) {
  const by = await admin();
  const drugCode = String(fd.get("drugCode") ?? "").trim();
  const displayName = String(fd.get("displayName") ?? "").trim();
  const originalName = String(fd.get("originalName") ?? "").trim() || null;
  if (!/^\d{9}$/.test(drugCode) || !displayName) return;
  await prisma.coMarketingMapping.upsert({
    where: { drugCode },
    create: { drugCode, displayName, originalName, updatedBy: by },
    update: { displayName, originalName, updatedBy: by, active: true },
  });
  revalidatePath("/admin/comarketing");
}

export async function toggleMapping(fd: FormData) {
  await admin();
  const id = String(fd.get("id") ?? "");
  const cur = await prisma.coMarketingMapping.findUnique({ where: { id } });
  if (!cur) return;
  await prisma.coMarketingMapping.update({ where: { id }, data: { active: !cur.active } });
  revalidatePath("/admin/comarketing");
}

export async function deleteMapping(fd: FormData) {
  await admin();
  const id = String(fd.get("id") ?? "");
  if (id) await prisma.coMarketingMapping.delete({ where: { id } });
  revalidatePath("/admin/comarketing");
}

/** CSV 벌크 임포트 — 각 줄 `drugCode,displayName[,originalName]`. */
export async function importCsv(fd: FormData) {
  const by = await admin();
  const csv = String(fd.get("csv") ?? "");
  let ok = 0;
  for (const line of csv.split(/\r?\n/)) {
    const cols = line.split(",").map((c) => c.trim());
    const [drugCode, displayName, originalName] = cols;
    if (!/^\d{9}$/.test(drugCode ?? "") || !displayName) continue; // 헤더/빈줄 스킵
    await prisma.coMarketingMapping.upsert({
      where: { drugCode },
      create: { drugCode, displayName, originalName: originalName || null, updatedBy: by },
      update: { displayName, originalName: originalName || null, updatedBy: by, active: true },
    });
    ok++;
  }
  revalidatePath("/admin/comarketing");
  redirect(`/admin/comarketing?imported=${ok}`);
}
