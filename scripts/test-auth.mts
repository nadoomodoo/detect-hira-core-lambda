/** 인증 로직 검증. DATABASE_URL=... npx tsx scripts/test-auth.mts */
import { PrismaClient } from "@prisma/client";
import { signupUser, loginUser } from "../src/auth.js";

const prisma = new PrismaClient();
const EMAIL = "auth-test@example.com";
let pass = 0, fail = 0;
const assert = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)); };

async function main() {
  const u = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (u) { await prisma.creditTx.deleteMany({ where: { userId: u.id } }); await prisma.creditAccount.deleteMany({ where: { userId: u.id } }); await prisma.user.delete({ where: { id: u.id } }); }

  console.log("[가입]");
  const created = await signupUser(EMAIL, "supersecret123", "테스트");
  assert(!!created.id && created.email === EMAIL && created.role === "USER", "가입 성공 (role=USER)");
  const acct = await prisma.creditAccount.findUnique({ where: { userId: created.id } });
  assert(acct?.balanceKrw === 0, "CreditAccount 자동 생성 (잔액 0)");

  console.log("[중복 가입]");
  let dup = false;
  try { await signupUser(EMAIL, "another12345"); } catch (e: any) { dup = e.message === "email_taken"; }
  assert(dup, "이메일 중복 → email_taken");

  console.log("[짧은 비밀번호]");
  let short = false;
  try { await signupUser("x@y.com", "short"); } catch (e: any) { short = e.message === "invalid_email_or_password"; }
  assert(short, "8자 미만 비밀번호 거부");

  console.log("[로그인]");
  assert((await loginUser(EMAIL, "supersecret123"))?.email === EMAIL, "올바른 비밀번호 → 로그인");
  assert((await loginUser(EMAIL, "wrongpassword")) === null, "틀린 비밀번호 → null");
  assert((await loginUser("nobody@x.com", "whatever12")) === null, "없는 이메일 → null");

  // 정리
  await prisma.creditAccount.deleteMany({ where: { userId: created.id } });
  await prisma.user.delete({ where: { id: created.id } });

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
