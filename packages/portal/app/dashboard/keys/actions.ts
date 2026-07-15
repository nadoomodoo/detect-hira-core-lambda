"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@platform/db";
import { issueApiKey } from "@/lib/keys";

export interface CreateKeyState { key?: string; prefix?: string; error?: string }

export async function createKeyAction(_prev: CreateKeyState | null): Promise<CreateKeyState> {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return { error: "unauthorized" };
  const { key, prefix } = await issueApiKey(userId);
  revalidatePath("/dashboard/keys");
  return { key, prefix };
}

export async function revokeKeyAction(fd: FormData) {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const id = String(fd.get("id") ?? "");
  if (!userId || !id) return;
  await prisma.apiKey.updateMany({ where: { id, userId }, data: { active: false } });
  revalidatePath("/dashboard/keys");
}
