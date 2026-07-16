/** 데모 고객 계정 시드 (브라우저 로그인 테스트용). DATABASE_URL=... npx tsx scripts/seed-demo.mts */
import { signupUser } from "../src/auth.js";
import { prisma } from "@platform/db";

const email = "demo@nadoomodoo.com";
const password = "demo12345678";

const ex = await prisma.user.findUnique({ where: { email } });
if (ex) {
  await prisma.creditTx.deleteMany({ where: { userId: ex.id } });
  await prisma.apiKey.deleteMany({ where: { userId: ex.id } });
  await prisma.entitlement.deleteMany({ where: { userId: ex.id } });
  await prisma.creditAccount.deleteMany({ where: { userId: ex.id } });
  await prisma.user.delete({ where: { id: ex.id } });
}
const u = await signupUser(email, password, "데모 고객");
await prisma.creditAccount.update({ where: { userId: u.id }, data: { balanceKrw: 50000 } });
// 데모 계정은 인증 절차 없이 바로 로그인 가능하도록 인증 완료 처리
await prisma.user.update({ where: { id: u.id }, data: { emailVerified: new Date() } });
console.log(`데모 계정: ${email} / ${password} (잔액 50,000원, 이메일 인증 완료)`);
await prisma.$disconnect();
