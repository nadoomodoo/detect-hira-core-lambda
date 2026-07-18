import { createServer, IncomingMessage } from "node:http";
import sharp from "sharp";
import { processImage } from "./pipeline.js";
import { storeResult } from "./storage.js";
import { formatUsageStats, getUsageStats, resetUsageStats } from "./ocr.js";
import { extractEdi } from "./extract.js";
import { persistExtraction, toApiView } from "./persist.js";

/**
 * processor-hira — Cloud Run HTTP 서비스 (컨트롤 플레인 API 뒤에서 프록시됨).
 *
 *   GET  /healthz     헬스체크
 *   POST /process     이미지 → 태깅/추출 결과 (binary body 또는 JSON {image|imageUrl})
 *
 * Lambda 대비 변경: 6MB 응답 우회책 제거, S3→GCS, API Gateway 제약 없음.
 */

const PORT = Number(process.env.PORT ?? 8080);
const MAX_BODY = Number(process.env.MAX_BODY_BYTES ?? 25 * 1024 * 1024);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error(`요청 본문이 한도(${MAX_BODY} bytes)를 초과`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function extractImage(req: IncomingMessage, body: Buffer): Promise<Buffer> {
  const ct = req.headers["content-type"] ?? "";
  if (ct.includes("application/json")) {
    const parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.image === "string") return Buffer.from(parsed.image, "base64");
    if (typeof parsed.imageUrl === "string") {
      const url = parsed.imageUrl;
      if (!url.startsWith("https://")) throw new Error("imageUrl 은 https:// 만 허용");
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`imageUrl 다운로드 실패: HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    }
    throw new Error("JSON 본문에 image(base64) 또는 imageUrl 이 필요");
  }
  // binary body (image/*)
  if (body.length === 0) throw new Error("이미지 본문이 비어있음");
  return body;
}

async function detectMime(image: Buffer): Promise<string> {
  const fmt = (await sharp(image).metadata()).format;
  return fmt === "jpeg" ? "image/jpeg" : "image/png";
}

/** 본문이 JSON 이면 파싱, 아니면 {} (binary body 대비). */
function safeJson(body: Buffer): Record<string, unknown> {
  try {
    const v = JSON.parse(body.toString("utf8"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const send = (code: number, obj: unknown) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };

  try {
    if (req.method === "GET" && req.url === "/healthz") return send(200, { ok: true });

    // ── EDI 숫자컬럼 추출 (hira-extract) ─────────────────────────
    // JSON body: { image|imageUrl, templateId?, model?, userId?, productId?, requestId?, jobItemId? }
    if (req.method === "POST" && req.url?.startsWith("/extract")) {
      resetUsageStats();
      const body = await readBody(req);
      const parsed = safeJson(body);
      const raw = await extractImage(req, body);
      const mime = await detectMime(raw);

      const result = await extractEdi(raw, mime, {
        templateId: typeof parsed.templateId === "string" ? parsed.templateId : undefined,
        modelOverride: typeof parsed.model === "string" ? parsed.model : undefined,
      });

      // 영속화 (userId/productId/requestId 있을 때만) — best-effort
      let extractionId: string | null = null;
      if (typeof parsed.userId === "string" && typeof parsed.productId === "string" && typeof parsed.requestId === "string") {
        try {
          extractionId = await persistExtraction(result, {
            requestId: parsed.requestId,
            userId: parsed.userId,
            productId: parsed.productId,
            jobItemId: typeof parsed.jobItemId === "string" ? parsed.jobItemId : null,
          });
        } catch (e) {
          console.warn("persist_extraction_failed:", e instanceof Error ? e.message : e);
        }
      }

      const costKrw = result.costs.reduce((s, c) => s + (c.costKrw ?? 0), 0);
      const costUsd = result.costs.reduce((s, c) => s + (c.costUsd ?? 0), 0);
      const tokensIn = result.costs.reduce((s, c) => s + c.tokensIn, 0);
      const tokensOut = result.costs.reduce((s, c) => s + c.tokensOut, 0);
      const latencyMs = result.costs.reduce((s, c) => s + c.latencyMs, 0);

      return send(200, {
        extractionId,
        ...toApiView(result),
        cost: { krw: costKrw, usd: costUsd },
        usage: { tokensIn, tokensOut, latencyMs, stages: result.costs },
      });
    }

    if (req.method !== "POST" || !req.url?.startsWith("/process")) {
      return send(404, { error: "not_found" });
    }

    resetUsageStats();
    const body = await readBody(req);
    const raw = await extractImage(req, body);

    const { result, baseImage, labeledImage, tagged, rotation } = await processImage(raw);

    const unknownCodes = [...new Set(result.items.filter((it) => !it.found).map((it) => it.code))];
    if (unknownCodes.length > 0) {
      console.log(`마스터 미조회 코드 ${unknownCodes.length}건: ${unknownCodes.join(", ")}`);
    }
    console.log(formatUsageStats());

    // 원본(라벨 좌표 기준 이미지) 저장 + (멀티면) 라벨 합성본 저장
    const original = await storeResult(baseImage, await detectMime(baseImage));
    const labeled = labeledImage ? await storeResult(labeledImage, "image/png") : null;
    const usage = getUsageStats().total;

    return send(200, {
      // 라벨링 정보(에디터용): 코드별 제약사 + 픽셀 좌표(원본 이미지 기준)
      items: result.items.map((it) => ({
        code: it.code,
        manufacturer: it.manufacturer,
        drugName: it.drugName,
        found: it.found,
        box: it.pixelBox, // { x, y, width, height } — original 이미지 픽셀 좌표
      })),
      uniqueManufacturers: result.uniqueManufacturers,
      width: result.width,
      height: result.height,
      tagged,
      rotation,
      unknownCodes,
      original, // 라벨 없는 원본(보정본) — 에디터 베이스
      labeled, // 라벨 합성본(멀티 제약사만, 아니면 null)
      output: labeled ?? original, // 표시용(하위호환): 멀티=라벨본, 단일=원본
      usage: {
        calls: usage.calls,
        tokensIn: usage.promptTokens,
        tokensOut: usage.outputTokens,
        latencyMs: usage.latencyMs,
      },
    });
  } catch (err) {
    // 원시 오류 메시지는 로그로만 — 호출자(게이트웨이)에는 일반 코드만 반환
    console.error("process error:", err instanceof Error ? err.stack ?? err.message : String(err));
    return send(500, { error: "processing_failed" });
  }
});

server.listen(PORT, () => {
  console.log(`processor-hira listening on :${PORT}`);
});
