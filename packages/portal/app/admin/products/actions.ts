"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@platform/db";

async function requireAdmin() {
  const session = await auth();
  if ((session?.user as any)?.role !== "ADMIN") throw new Error("forbidden");
}

/** 프로덕트 카테고리·설명·가격·무료쿼터·상태 인라인 수정. 가격 변경은 이후 호출부터 적용(과거는 스냅샷). */
export async function updateProduct(fd: FormData) {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const priceKrw = Math.max(0, Math.trunc(Number(fd.get("priceKrw") ?? 0)));
  const freeQuota = Math.max(0, Math.trunc(Number(fd.get("freeQuota") ?? 0)));
  const status = String(fd.get("status") ?? "ACTIVE") as "ACTIVE" | "BETA" | "DEPRECATED";
  const category = String(fd.get("category") ?? "").trim() || null;
  const description = String(fd.get("description") ?? "").trim() || null;
  if (!id) return;
  await prisma.product.update({ where: { id }, data: { priceKrw, freeQuota, status, category, description } });
  revalidatePath("/admin/products");
  revalidatePath("/"); // 랜딩 카탈로그(카테고리·설명) 갱신
}
