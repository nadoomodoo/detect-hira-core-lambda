import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { API_BASE } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATEWAY = process.env.GATEWAY_URL ?? API_BASE;
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";
const SLUG = "hira-extract";
const MAX_ITEMS = 30;

/**
 * 대시보드 배치 추출 제출 — 여러 이미지를 비동기 Job 으로 접수.
 * 로그인 회원 전용(본인 과금). 게이트웨이 내부 batch-async 로 위임.
 *  - 프로덕션(Cloud Tasks): 202 { jobId } → 클라이언트가 /api/demo/jobs/{id} 폴링.
 *  - 로컬(큐 미설정): 동기 처리 후 200 { jobId, results... } 즉시 반환.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "login_required", message: "로그인이 필요합니다." }, { status: 401 });
  if (!INTERNAL_SECRET) return NextResponse.json({ error: "demo_unavailable", message: "배치가 일시적으로 준비 중입니다." }, { status: 503 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json", message: "JSON 본문이 필요합니다." }, { status: 400 }); }
  const images: string[] = Array.isArray(body?.images) ? body.images.filter((s: any) => typeof s === "string" && s.length > 0) : [];
  if (images.length === 0) return NextResponse.json({ error: "no_items", message: "이미지를 선택해 주세요." }, { status: 400 });
  if (images.length > MAX_ITEMS) return NextResponse.json({ error: "too_many", message: `한 번에 최대 ${MAX_ITEMS}장까지 처리합니다. (선택 ${images.length}장)`, maxItems: MAX_ITEMS }, { status: 400 });
  const templateId = typeof body?.templateId === "string" ? body.templateId : undefined;
  const model = typeof body?.model === "string" ? body.model : undefined;

  try {
    const resp = await fetch(`${GATEWAY}/internal/v1/${SLUG}/extract-batch-async`, {
      method: "POST",
      headers: { "x-internal-secret": INTERNAL_SECRET, "x-user-id": userId, "content-type": "application/json" },
      body: JSON.stringify({ images, ...(templateId ? { templateId } : {}), ...(model ? { model } : {}) }),
    });
    const json = await resp.json().catch(() => ({}));
    return NextResponse.json(json, { status: resp.status });
  } catch {
    return NextResponse.json({ error: "processor_error", message: "배치 요청을 처리하지 못했습니다." }, { status: 502 });
  }
}
