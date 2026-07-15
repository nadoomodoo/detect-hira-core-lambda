/**
 * 게이트웨이 E2E 테스트용 데이터 시드 + API 키 발급.
 *   DATABASE_URL=... npx tsx scripts/seed-gateway-test.mts
 * 발급된 키를 stdout 마지막 줄(KEY=...)로 출력.
 */
import { PrismaClient } from "@prisma/client";
import { issueApiKey } from "../src/billing.js";

const prisma = new PrismaClient();
const U = "gw-user";
const PROCESSOR = process.env.TEST_PROCESSOR_URL ?? "http://localhost:8080";

async function main() {
  await prisma.creditTx.deleteMany({ where: { userId: U } });
  await prisma.apiKey.deleteMany({ where: { userId: U } });
  await prisma.entitlement.deleteMany({ where: { userId: U } });
  await prisma.creditAccount.deleteMany({ where: { userId: U } });
  await prisma.user.deleteMany({ where: { id: U } });

  await prisma.user.create({ data: { id: U, email: "gw-test@example.com" } });
  await prisma.creditAccount.create({ data: { userId: U, balanceKrw: 1000 } });

  await prisma.product.upsert({
    where: { slug: "hira-detect" },
    create: { slug: "hira-detect", name: "HIRA 약가코드 검출", priceKrw: 200, freeQuota: 10, processorUrl: PROCESSOR },
    update: { processorUrl: PROCESSOR, priceKrw: 200, freeQuota: 10, status: "ACTIVE" },
  });

  const { key } = await issueApiKey(U);
  console.log(`seeded: user=${U} balance=1000 product=hira-detect→${PROCESSOR}`);
  console.log(`KEY=${key}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
