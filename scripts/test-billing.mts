/**
 * 과금 엔진 동시성/정확성 검증.
 *   실행: DATABASE_URL=... npx tsx scripts/test-billing.mts
 */
import { PrismaClient } from "@prisma/client";
import { issueApiKey, verifyApiKey, chargeForCall, refund, InsufficientCreditError } from "../src/billing.js";

const prisma = new PrismaClient();
const U = "test-user";
const P = "test-product";
let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

async function setup() {
  // 기존 테스트 데이터 정리
  await prisma.creditTx.deleteMany({ where: { userId: U } });
  await prisma.apiKey.deleteMany({ where: { userId: U } });
  await prisma.entitlement.deleteMany({ where: { userId: U } });
  await prisma.creditAccount.deleteMany({ where: { userId: U } });
  await prisma.product.deleteMany({ where: { id: P } });
  await prisma.user.deleteMany({ where: { id: U } });

  await prisma.user.create({ data: { id: U, email: "billing-test@example.com" } });
  await prisma.product.create({ data: { id: P, slug: "test-hira", name: "Test", priceKrw: 200, freeQuota: 10, processorUrl: "http://x" } });
  await prisma.creditAccount.create({ data: { userId: U, balanceKrw: 3000 } }); // 유료 15건분
  await prisma.entitlement.create({ data: { userId: U, productId: P, freeUsed: 0 } });
}

async function main() {
  await setup();
  const product = { id: P, priceKrw: 200, freeQuota: 10 };

  // 1) API 키
  console.log("[API 키]");
  const { key, prefix } = await issueApiKey(U);
  assert(key.startsWith("pk_live_") && prefix.length === 12, "키 발급 형식");
  assert((await verifyApiKey(key)) === U, "키 검증 → userId");
  assert((await verifyApiKey("pk_live_wrong")) === null, "잘못된 키 → null");

  // 2) 동시성: 30건 병렬 (무료10 + 유료15 성공, 5 실패 기대)
  console.log("[동시성 30건 병렬]");
  const results = await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) => chargeForCall(U, product, `req-${i}`)),
  );
  const ok = results.filter((r) => r.status === "fulfilled");
  const free = ok.filter((r) => (r as any).value.free).length;
  const paid = ok.filter((r) => (r as any).value.charged).length;
  const insuff = results.filter((r) => r.status === "rejected" && (r as any).reason instanceof InsufficientCreditError).length;
  assert(free === 10, `무료 정확히 10건 (실제 ${free})`);
  assert(paid === 15, `유료 정확히 15건 (실제 ${paid})`);
  assert(insuff === 5, `잔액부족 5건 거부 (실제 ${insuff})`);

  const acct = await prisma.creditAccount.findUnique({ where: { userId: U } });
  assert(acct?.balanceKrw === 0, `잔액 0원 (실제 ${acct?.balanceKrw}) — 이중과금/음수 없음`);
  const ent = await prisma.entitlement.findUnique({ where: { userId_productId: { userId: U, productId: P } } });
  assert(ent?.freeUsed === 10, `freeUsed=10 (실제 ${ent?.freeUsed})`);
  const chargeCount = await prisma.creditTx.count({ where: { userId: U, type: "CHARGE" } });
  assert(chargeCount === 25, `CHARGE 원장 25건 (실제 ${chargeCount})`);

  // 3) idempotency: 이미 처리된 req 재호출 → 재과금 없음
  console.log("[idempotency]");
  const before = (await prisma.creditAccount.findUnique({ where: { userId: U } }))!.balanceKrw;
  const replay = await chargeForCall(U, product, "req-11"); // 유료였던 것
  assert(replay.replay === true, "재요청 replay=true");
  const after = (await prisma.creditAccount.findUnique({ where: { userId: U } }))!.balanceKrw;
  assert(before === after, `잔액 불변 (${before}=${after}) — 이중과금 방지`);

  // 4) 환불
  console.log("[환불]");
  const r1 = await refund(U, P, 200, "req-11");
  assert(r1 === true, "환불 성공");
  const bal2 = (await prisma.creditAccount.findUnique({ where: { userId: U } }))!.balanceKrw;
  assert(bal2 === 200, `환불 후 잔액 200 (실제 ${bal2})`);
  const r2 = await refund(U, P, 200, "req-11");
  assert(r2 === false, "중복 환불 거부 (idempotent)");

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
