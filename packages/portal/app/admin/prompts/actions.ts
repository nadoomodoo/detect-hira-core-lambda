"use server";

import { prisma } from "@platform/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * 프롬프트 템플릿 이력관리 서버 액션.
 * - 새 버전 생성: key 의 max(version)+1 로 추가(직전본을 parentId 로 계보 연결).
 * - 활성화(롤백 포함): 같은 key 의 다른 버전은 비활성, 대상만 active=true.
 */

function parseSchema(raw: string): any {
  const s = (raw ?? "").trim();
  if (!s) throw new Error("responseSchema JSON 이 비어있습니다.");
  return JSON.parse(s); // 실패 시 throw → 액션 에러
}

export async function createVersion(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim() || null;
  const body = String(formData.get("body") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim() || null;
  const schemaRaw = String(formData.get("responseSchema") ?? "").trim();
  const temperature = Number(formData.get("temperature") ?? 0);
  const activate = formData.get("activate") === "on";
  if (!key || !body) redirect("/admin/prompts?error=required");

  let responseSchema: any;
  try {
    responseSchema = parseSchema(schemaRaw);
  } catch {
    redirect("/admin/prompts?error=badschema");
  }

  const last = await prisma.promptTemplate.findFirst({ where: { key }, orderBy: { version: "desc" } });
  const version = (last?.version ?? 0) + 1;

  const created = await prisma.promptTemplate.create({
    data: {
      key,
      version,
      title,
      body,
      responseSchema,
      model,
      params: { temperature: Number.isFinite(temperature) ? temperature : 0 },
      active: false,
      parentId: last?.id ?? null,
      createdBy: "admin",
    },
  });

  if (activate) {
    await prisma.$transaction([
      prisma.promptTemplate.updateMany({ where: { key }, data: { active: false } }),
      prisma.promptTemplate.update({ where: { id: created.id }, data: { active: true } }),
    ]);
  }

  revalidatePath("/admin/prompts");
  redirect(`/admin/prompts?key=${encodeURIComponent(key)}&created=${version}`);
}

/** 특정 버전을 활성화(같은 key 내 롤백/전환). */
export async function activateVersion(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const key = String(formData.get("key") ?? "");
  if (!id || !key) return;
  await prisma.$transaction([
    prisma.promptTemplate.updateMany({ where: { key }, data: { active: false } }),
    prisma.promptTemplate.update({ where: { id }, data: { active: true } }),
  ]);
  revalidatePath("/admin/prompts");
}
