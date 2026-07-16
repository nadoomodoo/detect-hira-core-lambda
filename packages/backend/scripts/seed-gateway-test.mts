/**
 * 게이트웨이 E2E 테스트용 데이터 시드 + API 키 발급.
 *   DATABASE_URL=... npx tsx scripts/seed-gateway-test.mts
 * 발급된 키를 stdout 마지막 줄(KEY=...)로 출력.
 */
import { PrismaClient } from "@platform/db";
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
    create: { slug: "hira-detect", name: "멀티 제약사 라벨링", category: "제약 CSO", priceKrw: 200, freeQuota: 10, processorUrl: PROCESSOR, description: "처방전·EDI 이미지에서 약가코드를 검출해 제약사를 식별하고, 원본·라벨 이미지 + 좌표(JSON)를 반환합니다. 멀티 제약사는 색상 라벨을 합성하며, 좌표로 라벨 편집 에디터를 만들 수 있습니다." },
    update: { processorUrl: PROCESSOR, priceKrw: 200, freeQuota: 10, status: "ACTIVE" },
  });

  const { key } = await issueApiKey(U);
  console.log(`seeded: user=${U} balance=1000 product=hira-detect→${PROCESSOR}`);
  console.log(`KEY=${key}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
