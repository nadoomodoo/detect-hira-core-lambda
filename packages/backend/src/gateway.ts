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
 *   POST /api/v1/{slug}/detect         단건 — 이미지(binary 또는 JSON)
 *   POST /api/v1/{slug}/detect-batch   벌크 — JSON { images?: base64[], imageUrls?: uri[] }
 *     공통: 키검증 → Entitlement → (항목별) chargeForCall → processor → 성공/실패(환불)
 *     벌크는 제한 동시성으로 병렬 처리, 부분 성공 시 성공 건만 과금.
 */

const PORT = Number(process.env.PORT ?? process.env.GATEWAY_PORT ?? 8090);
const MAX_BODY = Number(process.env.MAX_BODY_BYTES ?? 25 * 1024 * 1024);
const APPLY_URL = process.env.APPLY_URL ?? "https://market.nadoo.ai/dashboard/apply";
const BULK_MAX_ITEMS = Number(process.env.BULK_MAX_ITEMS ?? 50);
const BULK_CONCURRENCY = Number(process.env.BULK_CONCURRENCY ?? 5);

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

interface Product { id: string; priceKrw: number; freeQuota: number; processorUrl: string }

/** 과금 → processor 처리 → (실패 시 환불) 한 건. HTTP 응답용 {status, payload} 반환(단건·벌크 공용). */
async function chargeAndProcess(
  userId: string,
  product: Product,
  apiKeyPrefix: string,
  requestId: string,
  procBody: Buffer,
  contentType: string,
): Promise<{ status: number; payload: Record<string, any> }> {
  const t0 = Date.now();
  let charge;
  try {
    charge = await chargeForCall(userId, product, requestId);
  } catch (e) {
    if (e instanceof InsufficientCreditError) {
      const ent = await db().entitlement.findUnique({ where: { userId_productId: { userId, productId: product.id } } });
      return {
        status: 402,
        payload: { error: "insufficient_credit", message: "무료 제공량을 모두 사용했고 크레딧 잔액이 부족합니다. 충전 후 다시 시도해 주세요.", freeUsed: ent?.freeUsed, freeQuota: product.freeQuota, applyUrl: APPLY_URL },
      };
    }
    throw e;
  }

  let proc;
  try {
    proc = await callProcessor(product.processorUrl, procBody, contentType);
    if (proc.status >= 400) throw new Error(`processor ${proc.status}`);
  } catch (err) {
    if (!charge.replay) await refund(userId, product.id, charge.unitPriceKrw, requestId);
    console.error("processor_error:", err instanceof Error ? err.message : err);
    void logUsage({
      ts: new Date().toISOString(), request_id: requestId, user_id: userId, product_id: product.id,
      api_key_prefix: apiKeyPrefix, status: "fail", billable_count: 0, cost_krw: 0,
      latency_ms: Date.now() - t0, error_code: "processor_error",
    });
    return { status: 502, payload: { error: "processor_error", message: "이미지 처리에 실패했습니다. 다른 이미지로 다시 시도해 주세요. 과금된 경우 자동 환불됩니다.", refunded: charge.charged } };
  }

  void logUsage({
    ts: new Date().toISOString(), request_id: requestId, user_id: userId, product_id: product.id,
    api_key_prefix: apiKeyPrefix, status: "ok", billable_count: 1,
    cost_krw: charge.unitPriceKrw, free_used: charge.free, latency_ms: Date.now() - t0,
    tokens_in: proc.json?.usage?.tokensIn, tokens_out: proc.json?.usage?.tokensOut,
    display_names: proc.json?.uniqueManufacturers, rotation: proc.json?.rotation,
  });
  return { status: 200, payload: { requestId, ...proc.json, cost: { krw: charge.unitPriceKrw, free: charge.free } } };
}

/** 제한 동시성 map. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** 키 검증 + 프로덕트 조회 + Entitlement 보장. 실패 시 {error}. */
async function authAndProduct(req: IncomingMessage, slug: string) {
  const apiKey = (req.headers["x-api-key"] as string) ?? "";
  const userId = apiKey ? await verifyApiKey(apiKey) : null;
  if (!userId) return { error: { status: 401, payload: { error: "invalid_key", message: "API 키가 없거나 올바르지 않습니다. 대시보드에서 발급한 키를 확인해 주세요." } } };
  const product = await db().product.findUnique({ where: { slug } });
  if (!product || product.status === "DEPRECATED") return { error: { status: 404, payload: { error: "product_not_found", message: "해당 API를 찾을 수 없거나 서비스가 종료되었습니다." } } };
  await db().entitlement.upsert({ where: { userId_productId: { userId, productId: product.id } }, create: { userId, productId: product.id }, update: {} });
  return { userId, product, apiKey };
}

const server = createServer(async (req, res) => {
  const send = (code: number, obj: unknown) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };

  try {
    const single = req.url?.match(/^\/api\/v1\/([\w-]+)\/detect$/);
    const batch = req.url?.match(/^\/api\/v1\/([\w-]+)\/detect-batch$/);
    if (req.method !== "POST" || (!single && !batch)) {
      return send(404, { error: "not_found", message: "요청하신 경로를 찾을 수 없습니다." });
    }
    const slug = (single ?? batch)![1];

    const ap = await authAndProduct(req, slug);
    if (ap.error) return send(ap.error.status, ap.error.payload);
    const { userId, product, apiKey } = ap;
    const idem = req.headers["idempotency-key"] as string | undefined;

    // ── 단건 ──
    if (single) {
      const body = await readBody(req);
      const contentType = (req.headers["content-type"] as string) ?? "application/octet-stream";
      const requestId = idem ?? randomUUID();
      const r = await chargeAndProcess(userId, product, apiKey.slice(0, 12), requestId, body, contentType);
      const acct = await db().creditAccount.findUnique({ where: { userId } });
      return send(r.status, r.status === 200 ? { ...r.payload, balanceKrw: acct?.balanceKrw ?? 0 } : r.payload);
    }

    // ── 벌크 ──
    const raw = await readBody(req);
    let parsed: any;
    try { parsed = JSON.parse(raw.toString("utf8")); } catch { return send(400, { error: "bad_json", message: "JSON 본문을 해석할 수 없습니다. { images: [...] } 또는 { imageUrls: [...] } 형식이어야 합니다." }); }
    const images: string[] = Array.isArray(parsed?.images) ? parsed.images : [];
    const imageUrls: string[] = Array.isArray(parsed?.imageUrls) ? parsed.imageUrls : [];
    const items = [
      ...images.map((v) => ({ kind: "image" as const, v })),
      ...imageUrls.map((v) => ({ kind: "imageUrl" as const, v })),
    ].filter((it) => typeof it.v === "string" && it.v.length > 0);

    if (items.length === 0) return send(400, { error: "no_items", message: "images(base64) 또는 imageUrls 배열에 최소 1건이 필요합니다." });
    if (items.length > BULK_MAX_ITEMS) return send(400, { error: "too_many_items", message: `한 번에 최대 ${BULK_MAX_ITEMS}건까지 처리할 수 있습니다. (요청 ${items.length}건)`, maxItems: BULK_MAX_ITEMS });

    const results = await mapLimit(items, BULK_CONCURRENCY, async (item, i) => {
      const rid = idem ? `${idem}:${i}` : randomUUID();
      const procBody = Buffer.from(JSON.stringify(item.kind === "image" ? { image: item.v } : { imageUrl: item.v }));
      const r = await chargeAndProcess(userId, product, apiKey.slice(0, 12), rid, procBody, "application/json");
      return { index: i, status: r.status, ...r.payload } as Record<string, any>;
    });

    const okCount = results.filter((r) => r.status === 200).length;
    const totalCostKrw = results.reduce((s, r) => s + (r.cost?.krw ?? 0), 0);
    const acct = await db().creditAccount.findUnique({ where: { userId } });
    return send(200, {
      batch: true,
      count: items.length,
      ok: okCount,
      failed: items.length - okCount,
      totalCostKrw,
      balanceKrw: acct?.balanceKrw ?? 0,
      results,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "body too large") {
      return send(413, { error: "payload_too_large", message: `요청 본문이 너무 큽니다. ${Math.floor(MAX_BODY / (1024 * 1024))}MB 이하로 보내주세요. (대량 이미지는 imageUrls 사용 권장)`, maxBytes: MAX_BODY });
    }
    console.error("gateway_error:", err instanceof Error ? err.stack ?? err.message : err);
    return send(500, { error: "internal_error", message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
  }
});

server.listen(PORT, () => console.log(`gateway listening on :${PORT}`));
