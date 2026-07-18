import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@platform/db";

export const dynamic = "force-dynamic";

export default async function Apply({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; product?: string }>;
}) {
  const { sent, product: productSlug } = await searchParams;
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const products = await prisma.product.findMany({ where: { status: { not: "DEPRECATED" } }, orderBy: { name: "asc" } });
  // 마켓플레이스 카드에서 넘어온 경우 해당 프로덕트를 기본 선택
  const preselectId = products.find((p) => p.slug === productSlug)?.id;

  async function submit(fd: FormData) {
    "use server";
    const s = await auth();
    const uid = (s?.user as any)?.id as string | undefined;
    if (!uid) redirect("/login");
    const productId = String(fd.get("productId") ?? "");
    const contact = String(fd.get("contact") ?? "").trim();
    const expectedVolume = String(fd.get("expectedVolume") ?? "").trim();
    const purpose = String(fd.get("purpose") ?? "").trim();
    const product = await prisma.product.findUnique({ where: { id: productId } });

    await prisma.accessRequest.create({
      data: { userId: uid, productId, contact, expectedVolume: expectedVolume || null, purpose: purpose || null },
    });

    // Teams 알림 (best-effort)
    const hook = process.env.TEAMS_WEBHOOK_URL;
    if (hook) {
      try {
        await fetch(hook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: `🔔 새 사용신청\n· 유저: ${s?.user?.email}\n· 프로덕트: ${product?.name ?? productId}\n· 연락처: ${contact}\n· 예상 사용량: ${expectedVolume || "-"}\n· 용도: ${purpose || "-"}`,
          }),
        });
      } catch { /* 알림 실패는 신청 저장에 영향 없음 */ }
    }
    redirect("/dashboard/apply?sent=1");
  }

  return (
    <>
      <div className="page-header"><div><h1>사용 신청</h1><p className="purpose">무료 제공량 초과 시 유료 사용을 신청합니다. 검토 후 연락드립니다.</p></div></div>
      {sent && <div className="flashbar flashbar-success">신청이 접수되었습니다. 담당자가 검토 후 연락드립니다.</div>}
      <form className="form-section stack" action={submit}>
        <div className="field">
          <label>프로덕트</label>
          <select name="productId" className="cell-select" required style={{ height: 46, width: "100%" }} defaultValue={preselectId ?? ""}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field"><label>연락처 (이메일/전화)</label><input name="contact" required /></div>
        <div className="field"><label>예상 사용량 (월)</label><input name="expectedVolume" placeholder="예: 월 5,000건" /></div>
        <div className="field"><label>용도</label><input name="purpose" placeholder="예: 처방전 OCR 자동화" /></div>
        <button className="btn" type="submit" disabled={!userId}>신청하기</button>
      </form>
    </>
  );
}
