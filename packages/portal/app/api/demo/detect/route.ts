import { NextResponse } from "next/server";
import { prisma } from "@platform/db";
import { auth } from "@/auth";
import { API_BASE } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = Number(process.env.DEMO_DAILY_LIMIT ?? 5);
const GATEWAY = process.env.GATEWAY_URL ?? API_BASE;
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";
const SLUG = "hira-detect";
const MAX = 15 * 1024 * 1024;

/**
 * 라이브 데모.
 *  - 비로그인: 공용 데모 키 + IP 일일 한도(무료 체험).
 *  - 로그인 회원: 본인 계정으로 호출(무료 제공량 후 크레딧 차감) — 내부 신뢰 호출.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ error: "no_image", message: "이미지를 선택해 주세요." }, { status: 400 });
  if (buf.length > MAX) return NextResponse.json({ error: "too_large", message: `이미지 용량이 너무 큽니다. ${Math.floor(MAX / (1024 * 1024))}MB 이하로 올려 주세요.` }, { status: 413 });
  const ct = req.headers.get("content-type") || "image/jpeg";

  // ── 로그인 회원: 본인 계정 과금(무료 후 크레딧) ──
  if (userId) {
    if (!INTERNAL_SECRET) return NextResponse.json({ error: "demo_unavailable", message: "데모가 일시적으로 준비 중입니다." }, { status: 503 });
    let resp: Response;
    try {
      resp = await fetch(`${GATEWAY}/internal/v1/${SLUG}/detect`, {
        method: "POST",
        headers: { "x-internal-secret": INTERNAL_SECRET, "x-user-id": userId, "content-type": ct },
        body: new Uint8Array(buf),
      });
    } catch {
      return NextResponse.json({ error: "gateway_unreachable", message: "잠시 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
    }
    const json = await resp.json().catch(() => ({}));
    return NextResponse.json({ ...json, billed: true }, { status: resp.status });
  }

  // ── 비로그인: IP 일일 한도 + 공용 데모 키 ──
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const usage = await prisma.demoUsage
    .upsert({ where: { ip_day: { ip, day } }, create: { ip, day, count: 1 }, update: { count: { increment: 1 } } })
    .catch(() => null);
  if (usage && usage.count > LIMIT) {
    return NextResponse.json(
      { error: "demo_limit", limit: LIMIT, message: `데모 무료 체험은 하루 ${LIMIT}회예요. 로그인하면 계속 사용할 수 있어요 (무료 제공량 후 크레딧 차감).` },
      { status: 429 },
    );
  }

  const key = process.env.DEMO_API_KEY;
  if (!key) return NextResponse.json({ error: "demo_unavailable", message: "데모가 일시적으로 준비 중입니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });

  let resp: Response;
  try {
    resp = await fetch(`${GATEWAY}/api/v1/${SLUG}/detect`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": ct },
      body: new Uint8Array(buf),
    });
  } catch {
    return NextResponse.json({ error: "gateway_unreachable", message: "잠시 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
  const json = await resp.json().catch(() => ({}));
  return NextResponse.json(
    { ...json, demoRemaining: usage ? Math.max(0, LIMIT - usage.count) : null },
    { status: resp.status },
  );
}
