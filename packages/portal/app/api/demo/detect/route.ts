import { NextResponse } from "next/server";
import { prisma } from "@platform/db";
import { API_BASE } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = Number(process.env.DEMO_DAILY_LIMIT ?? 5);
const GATEWAY = process.env.GATEWAY_URL ?? API_BASE;
const MAX = 15 * 1024 * 1024;

/** 공개 라이브 데모 — IP 일일 한도, 서버측 데모 키로 게이트웨이 호출. */
export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const day = new Date().toISOString().slice(0, 10);

  const usage = await prisma.demoUsage
    .upsert({ where: { ip_day: { ip, day } }, create: { ip, day, count: 1 }, update: { count: { increment: 1 } } })
    .catch(() => null);
  if (usage && usage.count > LIMIT) {
    return NextResponse.json(
      { error: "demo_limit", limit: LIMIT, message: `데모는 하루 ${LIMIT}회로 제한됩니다. 가입하면 무제한으로 사용할 수 있어요.` },
      { status: 429 },
    );
  }

  const key = process.env.DEMO_API_KEY;
  if (!key) return NextResponse.json({ error: "demo_unavailable" }, { status: 503 });

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ error: "no_image" }, { status: 400 });
  if (buf.length > MAX) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const ct = req.headers.get("content-type") || "image/jpeg";
  let resp: Response;
  try {
    resp = await fetch(`${GATEWAY}/api/v1/hira-detect/detect`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": ct },
      body: new Uint8Array(buf),
    });
  } catch {
    return NextResponse.json({ error: "gateway_unreachable" }, { status: 502 });
  }
  const json = await resp.json().catch(() => ({}));
  return NextResponse.json(
    { ...json, demoRemaining: usage ? Math.max(0, LIMIT - usage.count) : null },
    { status: resp.status },
  );
}
