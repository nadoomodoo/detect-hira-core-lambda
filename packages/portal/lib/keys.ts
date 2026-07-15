import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@platform/db";

/** SHA-256 해시 (원문 미저장). backend src/billing.ts 와 동일 규약. */
export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** 새 API 키 발급 — 원문 1회 반환(해시 저장). */
export async function issueApiKey(userId: string): Promise<{ key: string; prefix: string }> {
  const secret = randomBytes(24).toString("base64url");
  const key = `pk_live_${secret}`;
  const prefix = key.slice(0, 12);
  await prisma.apiKey.create({ data: { userId, keyHash: hashKey(key), prefix } });
  return { key, prefix };
}
