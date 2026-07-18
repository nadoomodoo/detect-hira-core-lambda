"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma, ingestDrugPriceTable, parsePriceSheet } from "@platform/db";

async function admin() {
  const s = await auth();
  if ((s?.user as any)?.role !== "ADMIN") throw new Error("forbidden");
}

/**
 * 약제급여목록·상한금액표(xlsx) 업로드 → SCD Type 2 적재.
 * 변경분만 새 이력 버전으로 쌓고 이전 current 를 validTo 로 닫는다.
 * 폼: file(xlsx) + effectiveFrom(YYYY-MM-DD, 상한금액표 기준일).
 */
export async function uploadPriceTable(fd: FormData): Promise<void> {
  await admin();
  const file = fd.get("file");
  const fromStr = String(fd.get("effectiveFrom") ?? "").trim();
  if (!file || typeof file === "string") redirect("/admin/drug-prices?error=nofile");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr)) redirect("/admin/drug-prices?error=nodate");

  const buf = Buffer.from(await (file as File).arrayBuffer());
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) redirect("/admin/drug-prices?error=empty");

  const grid: Array<Array<string | number | null>> = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const arr: Array<string | number | null> = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      arr[col - 1] = (cell.text ?? "") as string;
    });
    grid.push(arr);
  });

  const { rows, skipped } = parsePriceSheet(grid);
  if (rows.length === 0) redirect("/admin/drug-prices?error=parse");

  const validFrom = new Date(`${fromStr}T00:00:00+09:00`); // KST 기준일
  const res = await ingestDrugPriceTable(prisma, rows, {
    validFrom,
    batch: (file as File).name,
  });

  revalidatePath("/admin/drug-prices");
  revalidatePath("/admin/master");
  const q = new URLSearchParams({
    ok: "1",
    total: String(res.total),
    inserted: String(res.inserted),
    changed: String(res.changed),
    unchanged: String(res.unchanged),
    skipped: String(skipped),
  });
  redirect(`/admin/drug-prices?${q}`);
}
