"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@platform/db";

export async function updateRequestStatus(fd: FormData) {
  const s = await auth();
  if ((s?.user as any)?.role !== "ADMIN") throw new Error("forbidden");
  const id = String(fd.get("id") ?? "");
  const status = String(fd.get("status") ?? "NEW") as "NEW" | "CONTACTED" | "APPROVED" | "REJECTED";
  if (!id) return;
  await prisma.accessRequest.update({ where: { id }, data: { status } });
  revalidatePath("/admin/requests");
}
