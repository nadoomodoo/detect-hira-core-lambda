import { createServer, IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import {
  db,
  verifyApiKey,
  chargeForCall,
  refund,
  InsufficientCreditError,
} from "./billing.js";
import { logUsage } from "./usage.js";

/**
 * 컨트롤 플레인 게이트웨이 (판매 API 표면).
 *
 *   POST /api/v1/{slug}/detect   x-api-key, 이미지(binary 또는 JSON)
 *     → 키검증 → Entitlement → chargeForCall → processor 프록시
 *       → 성공: 결과+비용+잔액 / 실패: refund + 502
 *
 * BigQuery 호출이력 적재는 M2 — 여기서는 구조화 로그로 스텁.
 */

const PORT = Number(process.env.PORT ?? process.env.GATEWAY_PORT ?? 8090);
const MAX_BODY = Number(process.env.MAX_BODY_BYTES ?? 25 * 1024 * 1024);
const APPLY_URL = process.env.APPLY_URL ?? "https://market.nadoo.ai/dashboard/apply";

const auth = new GoogleAuth();

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** processor 호출 — run.app private 이면 ID 토큰 첨부, 로컬이면 생략. */
async function callProcessor(
  processorUrl: string,
  body: Buffer,
  contentType: string,
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { "content-type": contentType };
  if (processorUrl.includes("run.app")) {
    const client = await auth.getIdTokenClient(processorUrl);
    const h = await client.getRequestHeaders();
    headers["authorization"] = h["Authorization"] ?? h["authorization"];
  }
  const resp = await fetch(`${processorUrl}/process`, { method: "POST", headers, body: new Uint8Array(body) });
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status, json };
}

const server = createServer(async (req, res) => {
  const send = (code: number, obj: unknown) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };
  const t0 = Date.now();

  try {
    const m = req.url?.match(/^\/api\/v1\/([\w-]+)\/detect$/);
    if (req.method !== "POST" || !m) return send(404, { error: "not_found", message: "요청하신 경로를 찾을 수 없습니다." });
    const slug = m[1];

    // 1) 키 검증
    const apiKey = (req.headers["x-api-key"] as string) ?? "";
    const userId = apiKey ? await verifyApiKey(apiKey) : null;
    if (!userId) return send(401, { error: "invalid_key", message: "API 키가 없거나 올바르지 않습니다. 대시보드에서 발급한 키를 확인해 주세요." });

    // 2) 프로덕트
    const product = await db().product.findUnique({ where: { slug } });
    if (!product || product.status === "DEPRECATED") return send(404, { error: "product_not_found", message: "해당 API를 찾을 수 없거나 서비스가 종료되었습니다." });

    // 3) Entitlement 보장 (없으면 생성)
    await db().entitlement.upsert({
      where: { userId_productId: { userId, productId: product.id } },
      create: { userId, productId: product.id },
      update: {},
    });

    // 4) 이미지 로드 (본문 초과/불량은 과금 전에 차단 → 오초과금 방지)
    const body = await readBody(req);
    const contentType = (req.headers["content-type"] as string) ?? "application/octet-stream";

    // 5) 과금 (원자)
    const requestId = (req.headers["idempotency-key"] as string) ?? randomUUID();
    let charge;
    try {
      charge = await chargeForCall(userId, product, requestId);
    } catch (e) {
      if (e instanceof InsufficientCreditError) {
        const ent = await db().entitlement.findUnique({ where: { userId_productId: { userId, productId: product.id } } });
        return send(402, { error: "insufficient_credit", message: "무료 제공량을 모두 사용했고 크레딧 잔액이 부족합니다. 충전 후 다시 시도해 주세요.", freeUsed: ent?.freeUsed, freeQuota: product.freeQuota, applyUrl: APPLY_URL });
      }
      throw e;
    }

    // 6) processor 프록시
    let proc;
    try {
      proc = await callProcessor(product.processorUrl, body, contentType);
      if (proc.status >= 400) throw new Error(`processor ${proc.status}`);
    } catch (err) {
      // 처리 실패 → 환불 + 실패 이력
      if (!charge.replay) await refund(userId, product.id, charge.unitPriceKrw, requestId);
      console.error("processor_error:", err instanceof Error ? err.message : err);
      void logUsage({
        ts: new Date().toISOString(), request_id: requestId, user_id: userId, product_id: product.id,
        api_key_prefix: apiKey.slice(0, 12), status: "fail", billable_count: 0, cost_krw: 0,
        latency_ms: Date.now() - t0, error_code: "processor_error",
      });
      return send(502, { error: "processor_error", message: "이미지 처리에 실패했습니다. 다른 이미지로 다시 시도해 주세요. 과금된 경우 자동 환불됩니다.", refunded: charge.charged });
    }

    // 7) 잔액 + BigQuery 호출이력 적재 (정산 근거)
    const acct = await db().creditAccount.findUnique({ where: { userId } });
    void logUsage({
      ts: new Date().toISOString(), request_id: requestId, user_id: userId, product_id: product.id,
      api_key_prefix: apiKey.slice(0, 12), status: "ok", billable_count: 1,
      cost_krw: charge.unitPriceKrw, free_used: charge.free, latency_ms: Date.now() - t0,
      tokens_in: proc.json?.usage?.tokensIn, tokens_out: proc.json?.usage?.tokensOut,
      display_names: proc.json?.uniqueManufacturers, rotation: proc.json?.rotation,
    });

    return send(200, {
      requestId,
      ...proc.json,
      cost: { krw: charge.unitPriceKrw, free: charge.free },
      balanceKrw: acct?.balanceKrw ?? 0,
    });
  } catch (err) {
    // 본문 초과는 사용자 교정 가능 → 413, 그 외 내부 오류는 상세를 숨기고 일반 코드만
    if (err instanceof Error && err.message === "body too large") {
      return send(413, { error: "payload_too_large", message: `이미지 용량이 너무 큽니다. ${Math.floor(MAX_BODY / (1024 * 1024))}MB 이하로 다시 시도해 주세요.`, maxBytes: MAX_BODY });
    }
    console.error("gateway_error:", err instanceof Error ? err.stack ?? err.message : err);
    return send(500, { error: "internal_error", message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
  }
});

server.listen(PORT, () => console.log(`gateway listening on :${PORT}`));
