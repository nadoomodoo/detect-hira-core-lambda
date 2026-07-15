import { scryptSync, timingSafeEqual } from "node:crypto";

/** 비밀번호 검증 — 저장 형식 `salt:hash` (hex, scrypt). src/auth.ts 와 동일 규약. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const known = Buffer.from(hash, "hex");
  return known.length === test.length && timingSafeEqual(known, test);
}
