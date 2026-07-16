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

/** 엑셀(.xlsx)/CSV 파일 업로드 벌크 임포트 — 열: 약가코드 · 표기 제약사명 · 원 제약사명(선택). */
export async function importFile(fd: FormData) {
  const by = await admin();
  const file = fd.get("file");
  if (!file || typeof file === "string" || file.size === 0) redirect("/admin/comarketing?error=nofile");
  const f = file as File;
  const buf = Buffer.from(await f.arrayBuffer());

  const rows: [string, string, string][] = [];
  if (f.name.toLowerCase().endsWith(".xlsx")) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    ws?.eachRow((row, i) => {
      if (i === 1) return; // 헤더 행 스킵
      rows.push([
        String(row.getCell(1).text ?? "").trim(),
        String(row.getCell(2).text ?? "").trim(),
        String(row.getCell(3).text ?? "").trim(),
      ]);
    });
  } else {
    // CSV(엑셀에서 CSV로 저장한 경우도 지원)
    for (const line of buf.toString("utf8").replace(/^﻿/, "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const c = line.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
      rows.push([c[0] ?? "", c[1] ?? "", c[2] ?? ""]);
    }
  }

  let ok = 0;
  for (const [drugCode, displayName, originalName] of rows) {
    if (!/^\d{9}$/.test(drugCode) || !displayName) continue; // 헤더/불량행 스킵
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
