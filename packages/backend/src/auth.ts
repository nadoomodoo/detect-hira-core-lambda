import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./billing.js";

/**
 * 고객 인증 로직 (이메일/암호). 서버 사이드 — NextAuth Credentials provider 의
 * authorize() 에서 loginUser() 를 호출한다. 어드민은 Google OpenID(별도).
 *
 * 비밀번호: scrypt (표준 crypto, 추가 의존성 없음). 저장 형식 `salt:hash` (hex).
 */

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const known = Buffer.from(hash, "hex");
  return known.length === test.length && timingSafeEqual(known, test);
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

/** 회원가입 — User + CreditAccount 생성. 이메일 중복 시 오류. */
export async function signupUser(
  email: string,
  password: string,
  name?: string,
): Promise<AuthUser> {
  if (!email.includes("@") || password.length < 8) {
    throw new Error("invalid_email_or_password");
  }
  const existing = await db().user.findUnique({ where: { email } });
  if (existing) throw new Error("email_taken");

  const user = await db().user.create({
    data: {
      email,
      name: name ?? null,
      passwordHash: hashPassword(password),
      credit: { create: { balanceKrw: 0 } },
    },
    select: { id: true, email: true, name: true, role: true },
  });
  return user;
}

/** 로그인 검증 — 성공 시 유저, 실패 시 null. */
export async function loginUser(
  email: string,
  password: string,
): Promise<AuthUser | null> {
  const user = await db().user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
