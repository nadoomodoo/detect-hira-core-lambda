/** 공개 데모용 계정 + API 키 (라이브 데모 서버측 호출용). DATABASE_URL=... npx tsx scripts/seed-demo-key.mts */
import { issueApiKey } from "../src/billing.js";
import { prisma } from "@platform/db";

const email = "demo-public@nadoo.ai";
let u = await prisma.user.findUnique({ where: { email } });
if (!u) {
  u = await prisma.user.create({ data: { email, name: "Public Demo", credit: { create: { balanceKrw: 100000 } } } });
} else {
  await prisma.creditAccount.upsert({ where: { userId: u.id }, create: { userId: u.id, balanceKrw: 100000 }, update: { balanceKrw: 100000 } });
}
const product = await prisma.product.findUnique({ where: { slug: "hira-detect" } });
if (product) {
  await prisma.entitlement.upsert({
    where: { userId_productId: { userId: u.id, productId: product.id } },
    create: { userId: u.id, productId: product.id },
    update: {},
  });
}
await prisma.apiKey.updateMany({ where: { userId: u.id }, data: { active: false } });
const { key } = await issueApiKey(u.id);
console.log(`DEMO_KEY=${key}`);
await prisma.$disconnect();
