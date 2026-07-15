"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma, Prisma } from "@platform/db";

async function admin() {
  const s = await auth();
  if ((s?.user as any)?.role !== "ADMIN") throw new Error("forbidden");
}

/** 단건 추가/수정 (drugCode 기준 upsert). */
export async function upsertDrug(fd: FormData) {
  await admin();
  const drugCode = String(fd.get("drugCode") ?? "").trim();
  const manufacturerName = String(fd.get("manufacturerName") ?? "").trim();
  const drugName = String(fd.get("drugName") ?? "").trim() || null;
  if (!/^\d{9}$/.test(drugCode) || !manufacturerName) redirect("/admin/master?error=invalid");
  await prisma.drugMaster.upsert({
    where: { drugCode },
    create: { drugCode, manufacturerName, drugName, source: "admin" },
    update: { manufacturerName, drugName, source: "admin" },
  });
  revalidatePath("/admin/master");
  redirect(`/admin/master?q=${drugCode}`);
}

export async function deleteDrug(fd: FormData) {
  await admin();
  const drugCode = String(fd.get("drugCode") ?? "");
  if (drugCode) await prisma.drugMaster.delete({ where: { drugCode } }).catch(() => null);
  revalidatePath("/admin/master");
}

/**
 * CSV 파일 벌크 임포트. 각 줄 `drugCode,manufacturerName[,drugName]`.
 * 청크 단위 raw upsert(ON CONFLICT)로 수만 행도 빠르게 반영. source='admin'.
 */
export async function importDrugCsv(fd: FormData) {
  await admin();
  const file = fd.get("file");
  const pasted = String(fd.get("csv") ?? "");
  const text = file && typeof file !== "string" ? await file.text() : pasted;
  if (!text.trim()) redirect("/admin/master?error=empty");

  type Row = { code: string; mfr: string; name: string | null };
  const rows: Row[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const [code, mfr, name] = cols;
    if (!/^\d{9}$/.test(code ?? "") || !mfr) { skipped++; continue; } // 헤더/불량행 스킵
    rows.push({ code, mfr, name: name || null });
  }

  const CHUNK = 1000;
  let ok = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map(
      (r) => Prisma.sql`(${r.code}, ${r.mfr}, ${r.name}, 'admin', NOW())`,
    );
    await prisma.$executeRaw`
      INSERT INTO "DrugMaster" ("drugCode", "manufacturerName", "drugName", "source", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("drugCode") DO UPDATE SET
        "manufacturerName" = EXCLUDED."manufacturerName",
        "drugName" = EXCLUDED."drugName",
        "source" = 'admin',
        "updatedAt" = NOW()
    `;
    ok += chunk.length;
  }
  revalidatePath("/admin/master");
  redirect(`/admin/master?imported=${ok}&skipped=${skipped}`);
}
