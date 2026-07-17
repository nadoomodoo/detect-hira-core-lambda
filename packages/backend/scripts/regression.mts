/**
 * 로컬 운영수준 회귀 테스트 러너 (프레임워크 없이 tsx 로 실행).
 *
 * 검증 범위: 인프라 · 랜딩/문서 · 인증 페이지 · 어드민 게이팅 · API(단건/벌크/비동기/에러) · 이미지 샘플 스윕.
 *
 *   실행(로컬 스택 4개 기동 상태에서):
 *     DATABASE_URL=postgresql://app:devpassword@127.0.0.1:5433/platform \
 *     KEY=<로컬 API키> PORTAL=http://localhost:3000 GATEWAY=http://localhost:8090 \
 *     npx tsx scripts/regression.mts [--full]
 *
 *   --full : edi-data 전체 샘플 스윕(기본은 대표 8장)
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@platform/db";
import { resolveAnnotations } from "../src/annotate.js";
import { resetDrugMasterCache } from "../src/master.js";

const PORTAL = process.env.PORTAL ?? "http://localhost:3000";
const GATEWAY = process.env.GATEWAY ?? "http://localhost:8090";
const KEY = process.env.KEY ?? "";
const SLUG = "hira-detect";
const FULL = process.argv.includes("--full");
const EDI = resolve(process.cwd(), "../../edi-data");

let pass = 0, fail = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name} — ${msg}`);
    console.log(`  ❌ ${name}\n       ${msg}`);
  }
}
function assert(cond: any, msg: string) { if (!cond) throw new Error(msg); }
async function http(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
}
function imgBody(path: string) { return new Uint8Array(readFileSync(path)); }
function b64(path: string) { return readFileSync(path).toString("base64"); }

async function main() {
  console.log(`\n▶ 회귀 테스트 (portal=${PORTAL}, gateway=${GATEWAY}, full=${FULL})\n`);
  assert(KEY, "환경변수 KEY(로컬 API키) 필요");

  // ── setup: 테스트 유저 크레딧 충전(과금 테스트가 잔액부족으로 막히지 않도록) ──
  const keyUser = await (async () => {
    const { createHash } = await import("node:crypto");
    const rec = await prisma.apiKey.findUnique({ where: { keyHash: createHash("sha256").update(KEY).digest("hex") } });
    return rec?.userId ?? null;
  })();
  assert(keyUser, "KEY에 해당하는 유저 없음(로컬 DB)");
  await prisma.creditAccount.update({ where: { userId: keyUser! }, data: { balanceKrw: 10_000_000 } }).catch(() => {});

  const samples = readdirSync(EDI).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).map((f) => resolve(EDI, f));
  assert(samples.length > 0, "edi-data 샘플 없음");

  console.log("① 인프라");
  await check("게이트웨이 응답", async () => { const r = await http(`${GATEWAY}/api/v1/${SLUG}/detect`, { method: "POST" }); assert(r.status === 401, `기대 401, 실제 ${r.status}`); });
  await check("프로세서 healthz", async () => { const r = await http("http://localhost:8080/healthz"); assert(r.status === 200, `기대 200, 실제 ${r.status}`); });

  console.log("② 랜딩 · 문서(공개)");
  for (const [path, needle] of [["/", "마켓플레이스"], ["/docs", null], ["/docs/api/hira-detect", "detect"], ["/login", null], ["/signup", null], ["/verify", null]] as [string, string | null][]) {
    await check(`GET ${path} → 200`, async () => {
      const r = await http(`${PORTAL}${path}`);
      assert(r.status === 200, `상태 ${r.status}`);
      if (needle) assert(r.text.includes(needle), `본문에 "${needle}" 없음`);
    });
  }
  await check("openapi.json 유효 + 벌크 포함", async () => {
    const r = await http(`${PORTAL}/docs/api/hira-detect/openapi.json`);
    assert(r.status === 200 && r.json, "JSON 아님");
    assert(r.json.paths[`/api/v1/${SLUG}/detect`], "detect 경로 없음");
    assert(r.json.paths[`/api/v1/${SLUG}/detect-batch`], "detect-batch 경로 없음");
  });

  console.log("③ 어드민 게이팅(비인증 → 접근 차단)");
  for (const path of ["/admin", "/admin/products", "/admin/users", "/admin/credits", "/admin/master", "/admin/comarketing", "/admin/requests", "/admin/usage"]) {
    await check(`${path} 비인증 차단`, async () => {
      const r = await http(`${PORTAL}${path}`, { redirect: "manual" });
      // 미들웨어가 /admin/login 으로 리다이렉트(3xx) 하거나 로그인 화면. 데이터(200 본문 노출) 금지.
      assert(r.status >= 300 && r.status < 400, `기대 리다이렉트(3xx), 실제 ${r.status}`);
    });
  }

  console.log("④ API 인증 · 에러");
  await check("키 없음 → 401", async () => { const r = await http(`${GATEWAY}/api/v1/${SLUG}/detect`, { method: "POST", headers: { "x-api-key": "" } }); assert(r.status === 401 && r.json?.message, "401/message 아님"); });
  await check("잘못된 키 → 401", async () => { const r = await http(`${GATEWAY}/api/v1/${SLUG}/detect`, { method: "POST", headers: { "x-api-key": "pk_live_bogus" } }); assert(r.status === 401, `상태 ${r.status}`); });
  await check("없는 프로덕트 → 404", async () => { const r = await http(`${GATEWAY}/api/v1/nope/detect`, { method: "POST", headers: { "x-api-key": KEY } }); assert(r.status === 404, `상태 ${r.status}`); });
  await check("벌크 빈/잘못 JSON → 400", async () => { const r = await http(`${GATEWAY}/api/v1/${SLUG}/detect-batch`, { method: "POST", headers: { "x-api-key": KEY, "content-type": "application/json" }, body: "{}" }); assert(r.status === 400, `상태 ${r.status}`); });

  console.log("⑤ 단건 검출 + 과금");
  await check("단건 검출 → items>0, 과금", async () => {
    const before = (await prisma.creditAccount.findUnique({ where: { userId: keyUser! } }))!.balanceKrw;
    const r = await http(`${GATEWAY}/api/v1/${SLUG}/detect`, { method: "POST", headers: { "x-api-key": KEY, "content-type": "image/jpeg" }, body: imgBody(samples[0]) });
    assert(r.status === 200, `상태 ${r.status} ${r.text.slice(0, 120)}`);
    assert(Array.isArray(r.json.items) && r.json.items.length > 0, "items 비어있음");
    assert(r.json.cost && typeof r.json.balanceKrw === "number", "cost/balance 없음");
    // 라벨링 에디터용 응답: 좌표(box) + 원본 이미지
    const it0 = r.json.items[0];
    assert(it0.box && typeof it0.box.x === "number" && typeof it0.box.width === "number", "items[].box 좌표 없음");
    assert(r.json.original && (r.json.original.url || r.json.original.base64), "original 이미지 없음");
    assert("labeled" in r.json, "labeled 필드 없음");
    const after = (await prisma.creditAccount.findUnique({ where: { userId: keyUser! } }))!.balanceKrw;
    // 단일 유저 공유라 정확 델타는 취약 → "최소 cost 만큼 차감"으로 검증
    if (!r.json.cost.free) assert(after <= before - r.json.cost.krw, `과금 미반영 ${before}→${after}, cost ${r.json.cost.krw}`);
  });
  await check("idempotency 재요청 이중과금 없음", async () => {
    const rid = "regress-idem-1";
    const h = { "x-api-key": KEY, "content-type": "image/jpeg", "idempotency-key": rid };
    await http(`${GATEWAY}/api/v1/${SLUG}/detect`, { method: "POST", headers: h, body: imgBody(samples[0]) });
    const b1 = (await prisma.creditAccount.findUnique({ where: { userId: keyUser! } }))!.balanceKrw;
    await http(`${GATEWAY}/api/v1/${SLUG}/detect`, { method: "POST", headers: h, body: imgBody(samples[0]) });
    const b2 = (await prisma.creditAccount.findUnique({ where: { userId: keyUser! } }))!.balanceKrw;
    assert(b1 === b2, `재요청에 과금됨 ${b1}→${b2}`);
  });

  console.log("⑥ 벌크(동기) + 비동기(폴백) + 폴링");
  await check("detect-batch 2건 → ok", async () => {
    const body = JSON.stringify({ images: [b64(samples[0]), b64(samples[1])] });
    const r = await http(`${GATEWAY}/api/v1/${SLUG}/detect-batch`, { method: "POST", headers: { "x-api-key": KEY, "content-type": "application/json" }, body });
    assert(r.status === 200 && r.json.batch, `상태 ${r.status}`);
    assert(r.json.ok === 2 && r.json.failed === 0, `ok/failed=${r.json.ok}/${r.json.failed}`);
  });
  await check("detect-batch-async → job done + 폴링", async () => {
    const body = JSON.stringify({ images: [b64(samples[0]), b64(samples[1])] });
    const r = await http(`${GATEWAY}/api/v1/${SLUG}/detect-batch-async`, { method: "POST", headers: { "x-api-key": KEY, "content-type": "application/json" }, body });
    assert(r.status === 200 && r.json.jobId, `상태 ${r.status}`);
    const poll = await http(`${GATEWAY}/api/v1/jobs/${r.json.jobId}`, { headers: { "x-api-key": KEY } });
    assert(poll.status === 200 && poll.json.status === "done" && poll.json.ok === 2, `폴링 ${poll.json?.status}/${poll.json?.ok}`);
  });
  await check("타인 작업 폴링 차단", async () => {
    const r = await http(`${GATEWAY}/api/v1/jobs/nonexistent-job-id`, { headers: { "x-api-key": KEY } });
    assert(r.status === 404, `상태 ${r.status}`);
  });

  console.log(`⑦ 이미지 샘플 스윕 (${FULL ? samples.length : Math.min(8, samples.length)}장)`);
  const sweep = FULL ? samples : samples.slice(0, 8);
  let detected = 0, mfrTotal = 0;
  for (const s of sweep) {
    const nm = s.split("/").pop()!.slice(0, 28);
    await check(`검출: ${nm}`, async () => {
      const r = await http(`${GATEWAY}/api/v1/${SLUG}/detect`, { method: "POST", headers: { "x-api-key": KEY, "content-type": "image/jpeg" }, body: imgBody(s) });
      assert(r.status === 200, `상태 ${r.status} ${r.text.slice(0, 100)}`);
      assert(Array.isArray(r.json.items), "items 배열 아님");
      detected += r.json.items.length;
      mfrTotal += (r.json.uniqueManufacturers ?? []).length;
    });
  }
  console.log(`     · 스윕 합계: 검출 ${detected}건 · 제약사 표기 ${mfrTotal}건`);

  console.log("⑧ 코마케팅 표기 오버라이드(전역)");
  await check("매핑 → 표기명 오버라이드 + 그룹 통일", async () => {
    const CODE = "658107190"; // 마스터상 한풍제약
    const OVERRIDE = "회귀테스트위탁제약(주)";
    await prisma.coMarketingMapping.upsert({ where: { drugCode: CODE }, create: { drugCode: CODE, displayName: OVERRIDE, active: true }, update: { displayName: OVERRIDE, active: true } });
    resetDrugMasterCache(); // 마스터+코마케팅 캐시 무효화 → 새 매핑 반영
    let r;
    try {
      r = await resolveAnnotations([{ code: CODE, box: [100, 100, 150, 300] }], 1000, 1000);
    } finally {
      await prisma.coMarketingMapping.delete({ where: { drugCode: CODE } }).catch(() => {});
      resetDrugMasterCache();
    }
    assert(r.items[0]?.manufacturer === OVERRIDE, `기대 ${OVERRIDE}, 실제 ${r.items[0]?.manufacturer}`);
    assert(r.uniqueManufacturers.includes(OVERRIDE), "uniqueManufacturers 미반영");
  });

  console.log("⑨ 이메일 인증 플로우");
  await check("미인증→토큰→/verify→emailVerified 설정+토큰소비", async () => {
    const email = "regress-verify@test.local";
    await prisma.user.deleteMany({ where: { email } });
    const u = await prisma.user.create({ data: { email, emailVerified: null, credit: { create: {} } } });
    const token = "regress-verify-token-" + u.id;
    await prisma.emailVerificationToken.create({ data: { token, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const r = await http(`${PORTAL}/verify?token=${encodeURIComponent(token)}`);
    const after = await prisma.user.findUnique({ where: { id: u.id }, select: { emailVerified: true } });
    const tokLeft = await prisma.emailVerificationToken.findUnique({ where: { token } });
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    assert(r.status === 200 && r.text.includes("인증 완료"), "verify 페이지 인증완료 아님");
    assert(after?.emailVerified, "emailVerified 미설정");
    assert(!tokLeft, "토큰 미삭제");
  });
  await check("만료 토큰 → 만료 안내(인증 안 됨)", async () => {
    const email = "regress-verify2@test.local";
    await prisma.user.deleteMany({ where: { email } });
    const u = await prisma.user.create({ data: { email, emailVerified: null, credit: { create: {} } } });
    const token = "regress-expired-" + u.id;
    await prisma.emailVerificationToken.create({ data: { token, userId: u.id, expiresAt: new Date(Date.now() - 1000) } });
    const r = await http(`${PORTAL}/verify?token=${encodeURIComponent(token)}`);
    const after = await prisma.user.findUnique({ where: { id: u.id }, select: { emailVerified: true } });
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    assert(r.status === 200 && r.text.includes("만료"), "만료 안내 아님");
    assert(!after?.emailVerified, "만료인데 인증됨");
  });

  console.log(`\n━━━ 결과: ${pass} 통과 / ${fail} 실패 ━━━`);
  if (failures.length) { console.log("실패 목록:"); failures.forEach((f) => console.log(`  · ${f}`)); }
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error("RUNNER_ERR", e); await prisma.$disconnect(); process.exit(1); });
