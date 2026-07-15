import { createServer, IncomingMessage } from "node:http";
import sharp from "sharp";
import { processImage } from "./pipeline.js";
import { storeResult } from "./storage.js";
import { formatUsageStats, getUsageStats, resetUsageStats } from "./ocr.js";

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

const server = createServer(async (req, res) => {
  const send = (code: number, obj: unknown) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };

  try {
    if (req.method === "GET" && req.url === "/healthz") return send(200, { ok: true });
    if (req.method !== "POST" || !req.url?.startsWith("/process")) {
      return send(404, { error: "not_found" });
    }

    resetUsageStats();
    const body = await readBody(req);
    const raw = await extractImage(req, body);

    const { result, image, tagged, rotation } = await processImage(raw);

    const unknownCodes = [...new Set(result.items.filter((it) => !it.found).map((it) => it.code))];
    if (unknownCodes.length > 0) {
      console.log(`마스터 미조회 코드 ${unknownCodes.length}건: ${unknownCodes.join(", ")}`);
    }
    console.log(formatUsageStats());

    const contentType = tagged ? "image/png" : await detectMime(image);
    const stored = await storeResult(image, contentType);
    const usage = getUsageStats().total;

    return send(200, {
      items: result.items.map((it) => ({
        code: it.code,
        manufacturer: it.manufacturer,
        drugName: it.drugName,
        found: it.found,
      })),
      uniqueManufacturers: result.uniqueManufacturers,
      width: result.width,
      height: result.height,
      tagged,
      rotation,
      unknownCodes,
      output: stored,
      usage: {
        calls: usage.calls,
        tokensIn: usage.promptTokens,
        tokensOut: usage.outputTokens,
        latencyMs: usage.latencyMs,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("process error:", msg);
    return send(500, { error: msg });
  }
});

server.listen(PORT, () => {
  console.log(`processor-hira listening on :${PORT}`);
});
