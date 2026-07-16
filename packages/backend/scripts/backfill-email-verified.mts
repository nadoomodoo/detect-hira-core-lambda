/**
 * 이메일 인증 도입 마이그레이션 안전장치.
 *
 * emailVerified 컬럼 추가 후, 기존 유저(마이그레이션 이전 가입자)는 emailVerified=null 이 되어
 * credential 로그인이 차단된다. 이 스크립트는 마이그레이션 "직후 1회" 실행해
 * 기존 유저를 인증됨(가입일 기준)으로 백필하여 잠금을 방지한다.
 *
 * 신규 유저는 가입 시 인증 플로우를 타므로 영향 없음.
 *
 *   실행: DATABASE_URL=... npx tsx scripts/backfill-email-verified.mts [--dry]
 *   (프로드: cloud-sql-proxy 로 프로드 Cloud SQL 에 연결 후 실행)
 */
import { prisma } from "@platform/db";

const DRY = process.argv.includes("--dry");

async function main() {
  const pending = await prisma.user.count({ where: { emailVerified: null } });
  console.log(`emailVerified=null 유저: ${pending}명`);
  if (pending === 0) {
    console.log("백필 대상 없음.");
    return;
  }
  if (DRY) {
    console.log("[dry-run] 실제 변경 없음. --dry 없이 실행하면 createdAt 으로 백필합니다.");
    return;
  }
  // 가입일(createdAt)을 인증 시각으로 사용 — 감사상 "언제부터 유효했는지" 보존
  const rows = await prisma.user.findMany({ where: { emailVerified: null }, select: { id: true, createdAt: true } });
  let done = 0;
  for (const r of rows) {
    await prisma.user.update({ where: { id: r.id }, data: { emailVerified: r.createdAt } });
    done++;
  }
  console.log(`백필 완료: ${done}명 (emailVerified = 각자 createdAt)`);
}

main()
  .catch((e) => { console.error("BACKFILL_ERR", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
