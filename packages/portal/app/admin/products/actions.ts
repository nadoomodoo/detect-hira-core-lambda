"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma, Prisma } from "@platform/db";

async function requireAdmin() {
  const session = await auth();
  if ((session?.user as any)?.role !== "ADMIN") throw new Error("forbidden");
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 신규 프로덕트 등록. slug 는 소문자·숫자·하이픈만, 중복 불가. */
export async function createProduct(fd: FormData) {
  await requireAdmin();
  const slug = String(fd.get("slug") ?? "").trim().toLowerCase();
  const name = String(fd.get("name") ?? "").trim();
  const processorUrl = String(fd.get("processorUrl") ?? "").trim();
  const priceKrw = Math.max(0, Math.trunc(Number(fd.get("priceKrw") ?? 0)));
  const freeQuota = Math.max(0, Math.trunc(Number(fd.get("freeQuota") ?? 10)));
  const billingUnit = String(fd.get("billingUnit") ?? "CALL") as "CALL" | "IMAGE" | "PAGE";
  const status = String(fd.get("status") ?? "BETA") as "ACTIVE" | "BETA" | "DEPRECATED";
  const category = String(fd.get("category") ?? "").trim() || null;
  const description = String(fd.get("description") ?? "").trim() || null;

  if (!slug || !SLUG_RE.test(slug)) redirect("/admin/products?error=slug");
  if (!name) redirect("/admin/products?error=name");
  if (!/^https?:\/\//.test(processorUrl)) redirect("/admin/products?error=processor");

  try {
    await prisma.product.create({
      data: { slug, name, processorUrl, priceKrw, freeQuota, billingUnit, status, category, description },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      redirect("/admin/products?error=duplicate");
    }
    throw e;
  }
  revalidatePath("/admin/products");
  revalidatePath("/");
  redirect("/admin/products?created=1");
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
