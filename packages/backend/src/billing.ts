import { createHash, randomBytes } from "node:crypto";
import { prisma, Prisma, type PrismaClient } from "@platform/db";

/**
 * 과금 엔진 — 동시성 안전(원자 트랜잭션 + idempotency).
 * 상세: docs/IMPLEMENTATION-PLAN.md §8
 */

export function db(): PrismaClient {
  return prisma;
}

export class InsufficientCreditError extends Error {
  constructor() {
    super("insufficient_credit");
    this.name = "InsufficientCreditError";
  }
}

// ── API 키 ─────────────────────────────────────────────
export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** 새 API 키 발급 — 원문은 1회만 반환(해시 저장). */
export async function issueApiKey(userId: string): Promise<{ key: string; prefix: string }> {
  const secret = randomBytes(24).toString("base64url");
  const key = `pk_live_${secret}`;
  const prefix = key.slice(0, 12);
  await db().apiKey.create({ data: { userId, keyHash: hashKey(key), prefix } });
  return { key, prefix };
}

/** API 키 검증 → userId (active 만). 없으면 null. */
export async function verifyApiKey(rawKey: string): Promise<string | null> {
  const rec = await db().apiKey.findUnique({ where: { keyHash: hashKey(rawKey) } });
  if (!rec || !rec.active) return null;
  db().apiKey.update({ where: { id: rec.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return rec.userId;
}

// ── 과금 ───────────────────────────────────────────────
export interface ChargeResult {
  charged: boolean; // 유료 차감 여부
  free: boolean; // 무료 티어 사용 여부
  unitPriceKrw: number; // 스냅샷 가격 (무료=0)
  replay: boolean; // idempotent 재요청
  bodyHash: string | null; // replay 시 최초 요청의 본문 해시(바인딩 검증용). 신규는 null.
}

interface Product {
  id: string;
  priceKrw: number;
  freeQuota: number;
}

/**
 * 호출 1건 과금. 한 트랜잭션 안에서:
 *  0) idempotency(requestId) 재요청이면 그대로 반환
 *  1) 무료 티어(freeUsed < freeQuota) 원자 증가 → 무료 처리
 *  2) 아니면 잔액(>= price) 원자 차감 → 유료 처리, 부족 시 InsufficientCreditError
 */
export async function chargeForCall(
  userId: string,
  product: Product,
  requestId: string,
  bodyHash: string,
): Promise<ChargeResult> {
  return db().$transaction(async (tx) => {
    const dup = await tx.creditTx.findUnique({ where: { requestId } });
    if (dup) {
      return {
        charged: dup.type === "CHARGE" && dup.deltaKrw < 0,
        free: dup.unitPriceKrw === 0,
        unitPriceKrw: dup.unitPriceKrw ?? 0,
        replay: true,
        bodyHash: dup.bodyHash,
      };
    }

    // 1) 무료 티어 (원자: freeUsed < freeQuota 조건부 증가)
    const freeUpd = await tx.$executeRaw`
      UPDATE "Entitlement" SET "freeUsed" = "freeUsed" + 1
      WHERE "userId" = ${userId} AND "productId" = ${product.id}
        AND "freeUsed" < ${product.freeQuota}`;
    if (freeUpd === 1) {
      await tx.creditTx.create({
        data: { userId, deltaKrw: 0, type: "CHARGE", productId: product.id, unitPriceKrw: 0, requestId, bodyHash, memo: "free-tier" },
      });
      return { charged: false, free: true, unitPriceKrw: 0, replay: false, bodyHash: null };
    }

    // 2) 유료 (원자: balance >= price 조건부 차감)
    const price = product.priceKrw;
    const paidUpd = await tx.$executeRaw`
      UPDATE "CreditAccount" SET "balanceKrw" = "balanceKrw" - ${price}
      WHERE "userId" = ${userId} AND "balanceKrw" >= ${price}`;
    if (paidUpd === 0) throw new InsufficientCreditError();

    await tx.creditTx.create({
      data: { userId, deltaKrw: -price, type: "CHARGE", productId: product.id, unitPriceKrw: price, requestId, bodyHash },
    });
    return { charged: true, free: false, unitPriceKrw: price, replay: false, bodyHash: null };
  });
}

/**
 * 접수 전 "부담 가능 건수" 추정 — 무료 잔여 + (유료: 잔액/단가). 과금 아님, 스냅샷 조회만.
 * 배치 제출 시 0건이면 미리 반려해 헛접수(항목마다 insufficient_credit 실패)를 막는 용도.
 * 실제 과금은 항목별 chargeForCall 이 원자적으로 최종 판정한다(이 값은 UX 가드).
 */
export async function affordableCount(userId: string, product: Product): Promise<number> {
  const ent = await db().entitlement.findUnique({
    where: { userId_productId: { userId, productId: product.id } },
  });
  const freeRemaining = Math.max(0, product.freeQuota - (ent?.freeUsed ?? 0));
  const acct = await db().creditAccount.findUnique({ where: { userId } });
  const balance = acct?.balanceKrw ?? 0;
  const paid = product.priceKrw > 0 ? Math.floor(balance / product.priceKrw) : Number.MAX_SAFE_INTEGER;
  return freeRemaining + paid;
}

/** 처리 실패 시 환불 (idempotent: requestId+':refund'). */
export async function refund(
  userId: string,
  productId: string,
  priceKrw: number,
  requestId: string,
): Promise<boolean> {
  if (priceKrw <= 0) return false; // 무료 건은 환불 없음
  const refundId = `${requestId}:refund`;
  try {
    await db().$transaction(async (tx) => {
      await tx.creditTx.create({
        data: { userId, deltaKrw: priceKrw, type: "REFUND", productId, unitPriceKrw: priceKrw, requestId: refundId, memo: "processor-failure" },
      });
      await tx.$executeRaw`
        UPDATE "CreditAccount" SET "balanceKrw" = "balanceKrw" + ${priceKrw}
        WHERE "userId" = ${userId}`;
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false; // 이미 환불됨
    throw e;
  }
}
