import { createServer, IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import {
  db,
  verifyApiKey,
  chargeForCall,
  refund,
  affordableCount,
  InsufficientCreditError,
} from "./billing.js";
import { logUsage } from "./usage.js";
import { presignUpload } from "./storage.js";
import { isKnownModel, knownModels } from "./pricing.js";

/** 사용자 지정 model 이 지원 목록에 없으면 400 페이로드 반환(호출·과금 전 차단). 없거나 유효하면 null. */
function unsupportedModelError(parsed: any): Record<string, unknown> | null {
  if (typeof parsed?.model === "string" && !isKnownModel(parsed.model)) {
    return { error: "unsupported_model", message: `지원하지 않는 모델입니다: ${parsed.model}`, supported: knownModels() };
  }
  return null;
}

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
// 비동기 벌크(Cloud Tasks). 미설정 시 동기 폴백으로 동작(작업은 영속화).
const TASKS_QUEUE = process.env.CLOUD_TASKS_QUEUE; // projects/../locations/../queues/..
const WORKER_URL = process.env.WORKER_URL; // Cloud Tasks 가 호출할 게이트웨이 공개 URL
const TASKS_SA = process.env.CLOUD_TASKS_SA; // 워커 호출 OIDC 서비스계정 이메일
const WORKER_SECRET = process.env.WORKER_SECRET ?? ""; // 워커 엔드포인트 공유 시크릿
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? ""; // 포털→게이트웨이 내부 신뢰 호출 시크릿
const ASYNC_MAX_ITEMS = Number(process.env.ASYNC_MAX_ITEMS ?? 500);

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

/** processor 호출 — run.app private 이면 ID 토큰 첨부, 로컬이면 생략. path 기본 /process. */
async function callProcessor(
  processorUrl: string,
  body: Buffer,
  contentType: string,
  path: string = "/process",
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { "content-type": contentType };
  if (processorUrl.includes("run.app")) {
    const client = await auth.getIdTokenClient(processorUrl);
    const h = await client.getRequestHeaders();
    headers["authorization"] = h["Authorization"] ?? h["authorization"];
  }
  const resp = await fetch(`${processorUrl}${path}`, { method: "POST", headers, body: new Uint8Array(body) });
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
  path: string = "/process",
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
        payload: { error: "insufficient_credit", message: "무료 제공량을 모두 사용했고 잔액이 부족합니다. 충전 후 다시 시도해 주세요.", freeUsed: ent?.freeUsed, freeQuota: product.freeQuota, applyUrl: APPLY_URL },
      };
    }
    throw e;
  }

  let proc;
  try {
    proc = await callProcessor(product.processorUrl, procBody, contentType, path);
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

/** JobItem 1건 처리(워커/동기폴백 공용): 과금·프로세서 → 상태 갱신, Job 완료 집계. */
async function processJobItem(itemId: string): Promise<void> {
  // 재시도 안전(at-least-once): pending/processing 만 처리, attempts 증가
  const item = await db().jobItem.findUnique({ where: { id: itemId }, include: { job: true } });
  if (!item || (item.status !== "pending" && item.status !== "processing")) return;
  await db().jobItem.update({ where: { id: itemId }, data: { status: "processing", attempts: { increment: 1 } } }).catch(() => {});

  const product = await db().product.findUnique({ where: { id: item.job.productId } });
  let tally: "GREEN" | "YELLOW" | "RED" | null = null;
  if (!product) {
    await db().jobItem.update({ where: { id: itemId }, data: { status: "failed", error: "product_not_found" } });
  } else if (product.apiKind === "EXTRACT") {
    // ── EDI 추출 경로 (/extract) ──
    const input = item.input as { kind: string; v: string; templateId?: string; model?: string };
    const payload: Record<string, unknown> = {
      [input.kind === "image" ? "image" : "imageUrl"]: input.v,
      userId: item.job.userId,
      productId: product.id,
      requestId: item.requestId,
      jobItemId: item.id,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.model ? { model: input.model } : {}),
    };
    const r = await chargeAndProcess(item.job.userId, product, "batch", item.requestId, Buffer.from(JSON.stringify(payload)), "application/json", "/extract");
    const ok = r.status === 200;
    // 행 신호등 다수결로 item 대표 신호등 산정 (summary.byStatus)
    const byStatus = r.payload.summary?.byStatus as { green: number; yellow: number; red: number } | undefined;
    if (ok && byStatus) {
      tally = byStatus.red > 0 ? "RED" : byStatus.yellow > 0 ? "YELLOW" : "GREEN";
    }
    await db().jobItem.update({
      where: { id: itemId },
      data: {
        status: ok ? "ok" : "failed",
        costKrw: ok ? (r.payload.cost?.krw ?? 0) : 0,
        result: ok ? { extractionId: r.payload.extractionId, foundTable: r.payload.foundTable, itemCount: (r.payload.items ?? []).length, byStatus } : undefined,
        error: ok ? null : (r.payload.error as string),
      },
    });
  } else {
    const input = item.input as { kind: string; v: string };
    const procBody = Buffer.from(JSON.stringify(input.kind === "image" ? { image: input.v } : { imageUrl: input.v }));
    const r = await chargeAndProcess(item.job.userId, product, "batch", item.requestId, procBody, "application/json");
    const ok = r.status === 200;
    await db().jobItem.update({
      where: { id: itemId },
      data: {
        status: ok ? "ok" : "failed",
        costKrw: ok ? (r.payload.cost?.krw ?? 0) : 0,
        result: ok ? { items: r.payload.items, uniqueManufacturers: r.payload.uniqueManufacturers, tagged: r.payload.tagged, output: r.payload.output } : undefined,
        error: ok ? null : (r.payload.error as string),
      },
    });
  }

  // Job 집계: done +1, 실패/신호등 카운트
  const failedNow = (await db().jobItem.findUnique({ where: { id: itemId }, select: { status: true } }))?.status === "failed";
  await db().job.update({
    where: { id: item.jobId },
    data: {
      done: { increment: 1 },
      ...(failedNow ? { failed: { increment: 1 } } : {}),
      ...(tally === "GREEN" ? { greenCount: { increment: 1 } } : {}),
      ...(tally === "YELLOW" ? { yellowCount: { increment: 1 } } : {}),
      ...(tally === "RED" ? { redCount: { increment: 1 } } : {}),
    },
  });
  const job = await db().job.findUnique({ where: { id: item.jobId } });
  if (job && job.done >= job.total && job.status === "processing") {
    const finalStatus = job.failed >= job.total ? "failed" : job.failed > 0 ? "partial" : "done";
    await db().job.update({ where: { id: job.id }, data: { status: finalStatus } }).catch(() => {});
  }
}

/** Cloud Tasks 큐에 워커 호출 태스크 1건 등록(REST). 큐 미설정 시 false. */
async function enqueueCloudTask(jobItemId: string): Promise<boolean> {
  if (!TASKS_QUEUE || !WORKER_URL || !TASKS_SA) return false;
  const client = await auth.getClient();
  const body = Buffer.from(JSON.stringify({ jobItemId })).toString("base64");
  await client.request({
    url: `https://cloudtasks.googleapis.com/v2/${TASKS_QUEUE}/tasks`,
    method: "POST",
    data: {
      task: {
        httpRequest: {
          url: `${WORKER_URL}/internal/process-item`,
          httpMethod: "POST",
          headers: { "content-type": "application/json", "x-worker-secret": WORKER_SECRET },
          body,
          oidcToken: { serviceAccountEmail: TASKS_SA },
        },
      },
    },
  });
  return true;
}

/** Job + items → 폴링 응답 형태. */
function jobResponse(job: any) {
  const items = (job.items ?? []).sort((a: any, b: any) => a.idx - b.idx);
  return {
    jobId: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    ok: items.filter((i: any) => i.status === "ok").length,
    failed: job.failed ?? items.filter((i: any) => i.status === "failed").length,
    // 신호등 집계(추출 작업) — 대량 결과 중 리뷰 필요량 파악
    trafficLights: { green: job.greenCount ?? 0, yellow: job.yellowCount ?? 0, red: job.redCount ?? 0 },
    totalCostKrw: items.reduce((s: number, i: any) => s + (i.costKrw ?? 0), 0),
    results: items.map((i: any) => ({ index: i.idx, status: i.status, attempts: i.attempts, ...(i.result as object ?? {}), error: i.error ?? undefined })),
  };
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
    // ── 워커 (Cloud Tasks 타깃) — 공유 시크릿 인증 ──
    if (req.method === "POST" && req.url === "/internal/process-item") {
      if (!WORKER_SECRET || req.headers["x-worker-secret"] !== WORKER_SECRET) return send(403, { error: "forbidden" });
      const raw = await readBody(req);
      const { jobItemId } = JSON.parse(raw.toString("utf8") || "{}");
      if (!jobItemId) return send(400, { error: "no_item" });
      await processJobItem(String(jobItemId));
      return send(200, { ok: true });
    }

    // ── 내부 신뢰 호출 (포털 로그인 사용자 데모 등) — 시크릿 + userId 헤더로 본인 계정 과금 ──
    const internalM = req.url?.match(/^\/internal\/v1\/([\w-]+)\/detect$/);
    if (req.method === "POST" && internalM) {
      if (!INTERNAL_SECRET || req.headers["x-internal-secret"] !== INTERNAL_SECRET) return send(403, { error: "forbidden" });
      const uid = (req.headers["x-user-id"] as string) ?? "";
      if (!uid) return send(400, { error: "no_user" });
      const product = await db().product.findUnique({ where: { slug: internalM[1] } });
      if (!product || product.status === "DEPRECATED") return send(404, { error: "product_not_found", message: "해당 API를 찾을 수 없습니다." });
      await db().entitlement.upsert({ where: { userId_productId: { userId: uid, productId: product.id } }, create: { userId: uid, productId: product.id }, update: {} });
      const body = await readBody(req);
      const contentType = (req.headers["content-type"] as string) ?? "application/octet-stream";
      const requestId = (req.headers["idempotency-key"] as string) ?? randomUUID();
      const r = await chargeAndProcess(uid, product, "portal", requestId, body, contentType);
      const acct = await db().creditAccount.findUnique({ where: { userId: uid } });
      return send(r.status, r.status === 200 ? { ...r.payload, balanceKrw: acct?.balanceKrw ?? 0 } : r.payload);
    }

    // ── 내부 신뢰 호출: EDI 추출 데모 (포털 로그인 사용자) ──
    const internalExtract = req.url?.match(/^\/internal\/v1\/([\w-]+)\/extract$/);
    if (req.method === "POST" && internalExtract) {
      if (!INTERNAL_SECRET || req.headers["x-internal-secret"] !== INTERNAL_SECRET) return send(403, { error: "forbidden" });
      const uid = (req.headers["x-user-id"] as string) ?? "";
      if (!uid) return send(400, { error: "no_user" });
      const product = await db().product.findUnique({ where: { slug: internalExtract[1] } });
      if (!product || product.status === "DEPRECATED") return send(404, { error: "product_not_found", message: "해당 API를 찾을 수 없습니다." });
      await db().entitlement.upsert({ where: { userId_productId: { userId: uid, productId: product.id } }, create: { userId: uid, productId: product.id }, update: {} });
      const raw = await readBody(req);
      let parsed: any;
      try { parsed = JSON.parse(raw.toString("utf8")); } catch { return send(400, { error: "bad_json" }); }
      if (typeof parsed?.image !== "string" && typeof parsed?.imageUrl !== "string") return send(400, { error: "no_image" });
      { const bm = unsupportedModelError(parsed); if (bm) return send(400, bm); }
      const requestId = (req.headers["idempotency-key"] as string) ?? randomUUID();
      const payload: Record<string, unknown> = {
        ...(typeof parsed.image === "string" ? { image: parsed.image } : { imageUrl: parsed.imageUrl }),
        userId: uid, productId: product.id, requestId,
        ...(typeof parsed.templateId === "string" ? { templateId: parsed.templateId } : {}),
        ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
      };
      const r = await chargeAndProcess(uid, product, "portal", requestId, Buffer.from(JSON.stringify(payload)), "application/json", "/extract");
      const acct = await db().creditAccount.findUnique({ where: { userId: uid } });
      return send(r.status, r.status === 200 ? { ...r.payload, balanceKrw: acct?.balanceKrw ?? 0 } : r.payload);
    }

    // ── 내부(포털) 비동기 대량 처리 — 배치 UI 용. 세션 신뢰 호출(x-internal-secret + x-user-id).
    //    verb(extract|detect)는 라우팅용일 뿐 — 실제 처리 경로는 processJobItem 이 product.apiKind 로 분기. ──
    const internalBatchAsync = req.url?.match(/^\/internal\/v1\/([\w-]+)\/(?:extract|detect)-batch-async$/);
    if (req.method === "POST" && internalBatchAsync) {
      if (!INTERNAL_SECRET || req.headers["x-internal-secret"] !== INTERNAL_SECRET) return send(403, { error: "forbidden" });
      const uid = (req.headers["x-user-id"] as string) ?? "";
      if (!uid) return send(400, { error: "no_user" });
      const product = await db().product.findUnique({ where: { slug: internalBatchAsync[1] } });
      if (!product || product.status === "DEPRECATED") return send(404, { error: "product_not_found", message: "해당 API를 찾을 수 없습니다." });
      await db().entitlement.upsert({ where: { userId_productId: { userId: uid, productId: product.id } }, create: { userId: uid, productId: product.id }, update: {} });
      const raw = await readBody(req);
      let parsed: any;
      try { parsed = JSON.parse(raw.toString("utf8")); } catch { return send(400, { error: "bad_json" }); }
      { const bm = unsupportedModelError(parsed); if (bm) return send(400, bm); }
      const imgs: string[] = Array.isArray(parsed?.images) ? parsed.images : [];
      const urls: string[] = Array.isArray(parsed?.imageUrls) ? parsed.imageUrls : [];
      const templateId: string | undefined = typeof parsed?.templateId === "string" ? parsed.templateId : undefined;
      const model: string | undefined = typeof parsed?.model === "string" ? parsed.model : undefined;
      const list = [
        ...imgs.map((v) => ({ kind: "image" as const, v, ...(templateId ? { templateId } : {}), ...(model ? { model } : {}) })),
        ...urls.map((v) => ({ kind: "imageUrl" as const, v, ...(templateId ? { templateId } : {}), ...(model ? { model } : {}) })),
      ].filter((it) => typeof it.v === "string" && it.v.length > 0);
      if (list.length === 0) return send(400, { error: "no_items", message: "images 또는 imageUrls 배열에 최소 1건이 필요합니다." });
      if (list.length > ASYNC_MAX_ITEMS) return send(400, { error: "too_many_items", message: `비동기 배치는 최대 ${ASYNC_MAX_ITEMS}건입니다. (요청 ${list.length}건)`, maxItems: ASYNC_MAX_ITEMS });

      // 접수 전 잔액 사전 체크 — 한 건도 처리 불가면 헛접수(항목마다 실패) 대신 즉시 반려.
      const affordInternal = await affordableCount(uid, product);
      if (affordInternal === 0) {
        return send(402, { error: "insufficient_credit", message: `무료 제공량을 모두 사용했고 잔액이 부족합니다. ${list.length}장을 처리하려면 충전이 필요합니다.`, freeQuota: product.freeQuota, priceKrw: product.priceKrw, applyUrl: APPLY_URL });
      }

      const job = await db().job.create({ data: { userId: uid, productId: product.id, total: list.length } });
      const created = [];
      for (let i = 0; i < list.length; i++) {
        created.push(await db().jobItem.create({ data: { jobId: job.id, idx: i, requestId: randomUUID(), input: list[i] } }));
      }
      if (TASKS_QUEUE && WORKER_URL && TASKS_SA) {
        for (const ji of created) await enqueueCloudTask(ji.id);
        return send(202, { jobId: job.id, status: "queued", total: list.length, pollUrl: `/api/v1/jobs/${job.id}` });
      }
      await mapLimit(created, BULK_CONCURRENCY, (ji) => processJobItem(ji.id));
      const doneJob = await db().job.findUnique({ where: { id: job.id }, include: { items: true } });
      return send(200, jobResponse(doneJob));
    }

    // ── 대용량/대량 업로드용 presigned URL (base64 32MB 한계·페이로드 폭주 우회) ──
    //   POST /api/v1/uploads { contentType } → { uploadUrl, imageUrl, expiresIn }
    //   클라이언트: uploadUrl 로 이미지 PUT → imageUrl 을 extract 의 imageUrl 로 전달.
    if (req.method === "POST" && req.url === "/api/v1/uploads") {
      const apiKey = (req.headers["x-api-key"] as string) ?? "";
      const uid = apiKey ? await verifyApiKey(apiKey) : null;
      if (!uid) return send(401, { error: "invalid_key", message: "API 키가 없거나 올바르지 않습니다." });
      let ct = "image/jpeg";
      try {
        const b = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        if (typeof b.contentType === "string") ct = b.contentType;
      } catch { /* 기본 image/jpeg */ }
      const p = await presignUpload(ct).catch(() => null);
      if (!p) return send(503, { error: "upload_unavailable", message: "presigned 업로드가 구성되지 않았습니다(GCS_UPLOAD_BUCKET 필요). base64 또는 외부 imageUrl 을 사용하세요." });
      return send(200, p);
    }

    // ── 작업 폴링 GET /api/v1/jobs/{id} ──
    const pollM = req.url?.match(/^\/api\/v1\/jobs\/([\w-]+)$/);
    if (req.method === "GET" && pollM) {
      const apiKey = (req.headers["x-api-key"] as string) ?? "";
      const uid = apiKey ? await verifyApiKey(apiKey) : null;
      if (!uid) return send(401, { error: "invalid_key", message: "API 키가 없거나 올바르지 않습니다." });
      const job = await db().job.findUnique({ where: { id: pollM[1] }, include: { items: true } });
      if (!job || job.userId !== uid) return send(404, { error: "job_not_found", message: "작업을 찾을 수 없습니다." });
      return send(200, jobResponse(job));
    }

    const single = req.url?.match(/^\/api\/v1\/([\w-]+)\/detect$/);
    const batch = req.url?.match(/^\/api\/v1\/([\w-]+)\/detect-batch$/);
    const async = req.url?.match(/^\/api\/v1\/([\w-]+)\/detect-batch-async$/);
    // EDI 추출 (hira-extract): 단건 + 비동기 대량
    const extractSingle = req.url?.match(/^\/api\/v1\/([\w-]+)\/extract$/);
    const extractAsync = req.url?.match(/^\/api\/v1\/([\w-]+)\/extract-batch-async$/);
    if (req.method !== "POST" || (!single && !batch && !async && !extractSingle && !extractAsync)) {
      return send(404, { error: "not_found", message: "요청하신 경로를 찾을 수 없습니다." });
    }
    const slug = (single ?? batch ?? async ?? extractSingle ?? extractAsync)![1];

    const ap = await authAndProduct(req, slug);
    if (ap.error) return send(ap.error.status, ap.error.payload);
    const { userId, product, apiKey } = ap;
    const idem = req.headers["idempotency-key"] as string | undefined;

    // ── EDI 추출 단건 (/extract) — JSON { image|imageUrl, templateId?, model? } ──
    if (extractSingle) {
      const raw = await readBody(req);
      let parsed: any;
      try { parsed = JSON.parse(raw.toString("utf8")); } catch { return send(400, { error: "bad_json", message: "JSON 본문이 필요합니다. { image 또는 imageUrl, templateId? }" }); }
      if (typeof parsed?.image !== "string" && typeof parsed?.imageUrl !== "string") {
        return send(400, { error: "no_image", message: "image(base64) 또는 imageUrl 이 필요합니다." });
      }
      { const bm = unsupportedModelError(parsed); if (bm) return send(400, bm); }
      const requestId = idem ?? randomUUID();
      const payload: Record<string, unknown> = {
        ...(typeof parsed.image === "string" ? { image: parsed.image } : { imageUrl: parsed.imageUrl }),
        userId, productId: product.id, requestId,
        ...(typeof parsed.templateId === "string" ? { templateId: parsed.templateId } : {}),
        ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
      };
      const r = await chargeAndProcess(userId, product, apiKey.slice(0, 12), requestId, Buffer.from(JSON.stringify(payload)), "application/json", "/extract");
      const acct = await db().creditAccount.findUnique({ where: { userId } });
      return send(r.status, r.status === 200 ? { ...r.payload, balanceKrw: acct?.balanceKrw ?? 0 } : r.payload);
    }

    // ── EDI 추출 비동기 대량 (/extract-batch-async) ──
    if (extractAsync) {
      const raw = await readBody(req);
      let parsed: any;
      try { parsed = JSON.parse(raw.toString("utf8")); } catch { return send(400, { error: "bad_json", message: "JSON 본문 해석 불가. { imageUrls: [...] } 형식." }); }
      { const bm = unsupportedModelError(parsed); if (bm) return send(400, bm); }
      const imgs: string[] = Array.isArray(parsed?.images) ? parsed.images : [];
      const urls: string[] = Array.isArray(parsed?.imageUrls) ? parsed.imageUrls : [];
      const templateId: string | undefined = typeof parsed?.templateId === "string" ? parsed.templateId : undefined;
      const model: string | undefined = typeof parsed?.model === "string" ? parsed.model : undefined;
      const list = [
        ...imgs.map((v) => ({ kind: "image" as const, v, ...(templateId ? { templateId } : {}), ...(model ? { model } : {}) })),
        ...urls.map((v) => ({ kind: "imageUrl" as const, v, ...(templateId ? { templateId } : {}), ...(model ? { model } : {}) })),
      ].filter((it) => typeof it.v === "string" && it.v.length > 0);
      if (list.length === 0) return send(400, { error: "no_items", message: "images 또는 imageUrls 배열에 최소 1건이 필요합니다." });
      if (list.length > ASYNC_MAX_ITEMS) return send(400, { error: "too_many_items", message: `비동기 배치는 최대 ${ASYNC_MAX_ITEMS}건입니다. (요청 ${list.length}건)`, maxItems: ASYNC_MAX_ITEMS });

      // 접수 전 잔액 사전 체크 — 한 건도 처리 불가면 헛접수(항목마다 실패) 대신 즉시 반려.
      const afford = await affordableCount(userId, product);
      if (afford === 0) {
        return send(402, { error: "insufficient_credit", message: `무료 제공량을 모두 사용했고 잔액이 부족합니다. ${list.length}장을 처리하려면 충전이 필요합니다.`, freeQuota: product.freeQuota, priceKrw: product.priceKrw, applyUrl: APPLY_URL });
      }

      const job = await db().job.create({ data: { userId, productId: product.id, total: list.length } });
      const created = [];
      for (let i = 0; i < list.length; i++) {
        created.push(await db().jobItem.create({ data: { jobId: job.id, idx: i, requestId: idem ? `${idem}:${i}` : randomUUID(), input: list[i] } }));
      }
      if (TASKS_QUEUE && WORKER_URL && TASKS_SA) {
        for (const ji of created) await enqueueCloudTask(ji.id);
        return send(202, { jobId: job.id, status: "queued", total: list.length, pollUrl: `/api/v1/jobs/${job.id}` });
      }
      await mapLimit(created, BULK_CONCURRENCY, (ji) => processJobItem(ji.id));
      const doneJob = await db().job.findUnique({ where: { id: job.id }, include: { items: true } });
      return send(200, jobResponse(doneJob));
    }

    // ── 비동기 벌크 (작업 영속화 + Cloud Tasks, 미설정 시 동기 폴백) ──
    if (async) {
      const raw = await readBody(req);
      let parsed: any;
      try { parsed = JSON.parse(raw.toString("utf8")); } catch { return send(400, { error: "bad_json", message: "JSON 본문 해석 불가. { imageUrls: [...] } 형식." }); }
      const imgs: string[] = Array.isArray(parsed?.images) ? parsed.images : [];
      const urls: string[] = Array.isArray(parsed?.imageUrls) ? parsed.imageUrls : [];
      const list = [
        ...imgs.map((v) => ({ kind: "image" as const, v })),
        ...urls.map((v) => ({ kind: "imageUrl" as const, v })),
      ].filter((it) => typeof it.v === "string" && it.v.length > 0);
      if (list.length === 0) return send(400, { error: "no_items", message: "images 또는 imageUrls 배열에 최소 1건이 필요합니다." });
      if (list.length > ASYNC_MAX_ITEMS) return send(400, { error: "too_many_items", message: `비동기 배치는 최대 ${ASYNC_MAX_ITEMS}건입니다. (요청 ${list.length}건)`, maxItems: ASYNC_MAX_ITEMS });

      // 접수 전 잔액 사전 체크 — 한 건도 처리 불가면 헛접수(항목마다 실패) 대신 즉시 반려.
      const afford = await affordableCount(userId, product);
      if (afford === 0) {
        return send(402, { error: "insufficient_credit", message: `무료 제공량을 모두 사용했고 잔액이 부족합니다. ${list.length}건을 처리하려면 충전이 필요합니다.`, freeQuota: product.freeQuota, priceKrw: product.priceKrw, applyUrl: APPLY_URL });
      }

      const job = await db().job.create({ data: { userId, productId: product.id, total: list.length } });
      const created = [];
      for (let i = 0; i < list.length; i++) {
        created.push(await db().jobItem.create({ data: { jobId: job.id, idx: i, requestId: idem ? `${idem}:${i}` : randomUUID(), input: list[i] } }));
      }

      if (TASKS_QUEUE && WORKER_URL && TASKS_SA) {
        for (const ji of created) await enqueueCloudTask(ji.id);
        return send(202, { jobId: job.id, status: "queued", total: list.length, pollUrl: `/api/v1/jobs/${job.id}` });
      }
      // 동기 폴백: 즉시 처리하고 완료 결과 반환(작업도 영속화됨)
      await mapLimit(created, BULK_CONCURRENCY, (ji) => processJobItem(ji.id));
      const doneJob = await db().job.findUnique({ where: { id: job.id }, include: { items: true } });
      return send(200, jobResponse(doneJob));
    }

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
