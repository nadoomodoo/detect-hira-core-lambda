/**
 * 로컬 배치 병렬처리 통합 테스트 — 게이트웨이(8091, 내 코드) 내부 batch-async 를 두드려
 * (A) 잔액 사전 반려(402) (B) 병렬 정상 (C) 부분 실패 사유 노출 을 검증하고 문제점을 로깅한다.
 *   PORT 8091 게이트웨이 기동 상태에서:
 *   CROP_SERVICE_URL=... npx tsx --env-file=../../.env scripts/itest-batch-local.mts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@platform/db";

const GW = process.env.TEST_GATEWAY ?? "http://127.0.0.1:8091";
const SECRET = process.env.INTERNAL_API_SECRET ?? "";
const SLUG = "hira-extract";
const UID = "batch-local-test-user";
const EDI = "/Users/hamelmoon/workspaces/detect-hira-code/edi-data";

if (!SECRET) { console.error("INTERNAL_API_SECRET 미설정"); process.exit(1); }

const product = await prisma.product.findUnique({ where: { slug: SLUG } });
if (!product) { console.error("hira-extract Product 없음"); process.exit(1); }
console.log(`product: price=${product.priceKrw} freeQuota=${product.freeQuota} processorUrl=${product.processorUrl}`);

// 테스트 유저 준비
await prisma.user.upsert({ where: { id: UID }, create: { id: UID, email: "batch-local@test.local" }, update: {} });
await prisma.entitlement.upsert({
  where: { userId_productId: { userId: UID, productId: product.id } },
  create: { userId: UID, productId: product.id, freeUsed: product.freeQuota },
  update: { freeUsed: product.freeQuota }, // 무료 소진 상태로 고정(잔액 경로 강제)
});
async function setBalance(krw: number) {
  await prisma.creditAccount.upsert({ where: { userId: UID }, create: { userId: UID, balanceKrw: krw }, update: { balanceKrw: krw } });
}

// 이미지 3장 base64 (다운스케일)
const files = readdirSync(EDI).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort().slice(0, 3);
const images = await Promise.all(files.map(async (f) => {
  const buf = await sharp(readFileSync(join(EDI, f))).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return buf.toString("base64");
}));
console.log(`이미지 ${images.length}장 준비: ${files.join(", ")}\n`);

async function postBatch(imgs: string[]) {
  const t0 = Date.now();
  const resp = await fetch(`${GW}/internal/v1/${SLUG}/extract-batch-async`, {
    method: "POST",
    headers: { "x-internal-secret": SECRET, "x-user-id": UID, "content-type": "application/json" },
    body: JSON.stringify({ images: imgs }),
  });
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status, json, ms: Date.now() - t0 };
}

const problems: string[] = [];
function check(cond: boolean, ok: string, bad: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${cond ? ok : bad}`);
  if (!cond) problems.push(bad);
}

// ── A) 잔액 0 → 사전 반려 402 ──
console.log("[A] 잔액 0 + 무료소진 → 접수 전 402 반려 기대");
await setBalance(0);
const jobsBefore = await prisma.job.count({ where: { userId: UID } });
const a = await postBatch(images);
console.log(`  응답: ${a.status} ${JSON.stringify(a.json).slice(0, 160)}`);
check(a.status === 402, "402 반려", `기대 402 인데 ${a.status}`);
check(a.json?.error === "insufficient_credit", "error=insufficient_credit", `error=${a.json?.error}`);
const jobsAfterA = await prisma.job.count({ where: { userId: UID } });
check(jobsAfterA === jobsBefore, "헛접수 없음(Job 미생성)", `Job 이 ${jobsAfterA - jobsBefore}건 생성됨(헛접수)`);

// ── B) 잔액 충분 → 병렬 정상 ──
console.log(`\n[B] 잔액 ${product.priceKrw * images.length}원(=${images.length}장) → 병렬 정상 처리 기대`);
await setBalance(product.priceKrw * images.length);
const b = await postBatch(images);
console.log(`  응답: ${b.status} ${b.ms}ms status=${b.json?.status} done=${b.json?.done}/${b.json?.total} failed=${b.json?.failed}`);
check(b.status === 200, "200 접수·처리", `기대 200 인데 ${b.status}`);
check(b.json?.done === images.length, `done=${images.length}`, `done=${b.json?.done}`);
const bItems = (b.json?.results ?? b.json?.items ?? []) as any[];
console.log(`  항목: ${bItems.map((i) => `#${i.index}:${i.status}${i.error ? "(" + i.error + ")" : ""}`).join(" ")}`);
check(["done", "partial"].includes(b.json?.status), `job.status=${b.json?.status}`, `최종상태 이상: ${b.json?.status}`);
const bal = await prisma.creditAccount.findUnique({ where: { userId: UID } });
console.log(`  처리 후 잔액: ${bal?.balanceKrw}원 (성공 ${bItems.filter((i) => i.status === "ok").length}건 과금 기대)`);

// ── C) 잔액 1장분만 → 부분 실패 ──
console.log(`\n[C] 잔액 ${product.priceKrw}원(=1장) + 3장 제출 → 부분성공(1 ok, 2 insufficient) 기대`);
await setBalance(product.priceKrw);
const c = await postBatch(images);
console.log(`  응답: ${c.status} status=${c.json?.status} done=${c.json?.done}/${c.json?.total} failed=${c.json?.failed}`);
const cItems = (c.json?.results ?? c.json?.items ?? []) as any[];
console.log(`  항목: ${cItems.map((i) => `#${i.index}:${i.status}${i.error ? "(" + i.error + ")" : ""}`).join(" ")}`);
check(c.status === 200, "200 접수(1건은 가능하므로 접수)", `기대 200 인데 ${c.status}`);
const okN = cItems.filter((i) => i.status === "ok").length;
const insufN = cItems.filter((i) => i.error === "insufficient_credit").length;
check(okN === 1, "성공 1건", `성공 ${okN}건(기대 1)`);
check(insufN === 2, "insufficient_credit 2건", `insufficient ${insufN}건(기대 2)`);
check(cItems.every((i) => i.status === "ok" || !!i.error), "실패 항목에 error 채워짐", "error 없는 실패 항목 존재");

// ── 정리 ──
console.log("\n[정리]");
const jobIds = (await prisma.job.findMany({ where: { userId: UID }, select: { id: true } })).map((j) => j.id);
await prisma.jobItem.deleteMany({ where: { jobId: { in: jobIds } } });
await prisma.job.deleteMany({ where: { userId: UID } });
await prisma.usageCost.deleteMany({ where: { userId: UID } }).catch(() => {});
await prisma.ediExtraction.deleteMany({ where: { userId: UID } }).catch(() => {});
await prisma.creditTx.deleteMany({ where: { userId: UID } });
await prisma.entitlement.deleteMany({ where: { userId: UID } });
await prisma.creditAccount.deleteMany({ where: { userId: UID } });
await prisma.user.delete({ where: { id: UID } }).catch(() => {});
console.log("  테스트 데이터 삭제 완료");

console.log(`\n${"=".repeat(50)}`);
console.log(problems.length === 0 ? "✅ 전체 통과 — 문제 없음" : `⚠️ 발견된 문제 ${problems.length}건:\n - ${problems.join("\n - ")}`);
await prisma.$disconnect();
process.exit(problems.length === 0 ? 0 : 2);
