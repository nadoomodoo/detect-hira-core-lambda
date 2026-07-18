"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@platform/db";

// 부가세 10% 포함 입금액에서 순액(충전액) 역산. deposit = charge + vat.
// ("use server" 파일은 export 가 전부 async 여야 하므로 비-export 로 둔다)
function splitVat(depositKrw: number) {
  const charge = Math.round(depositKrw / 1.1);
  const vat = depositKrw - charge;
  return { charge, vat };
}

const MIN_DEPOSIT = 11000; // 최소 입금액(순액 1만원 상당)

/** 무통장 입금 충전 요청 생성 — 금액 + 환불약관 동의. 실제 충전은 입금 확인 후 어드민이 확정. */
export async function createTopUp(fd: FormData) {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) redirect("/login");

  const depositKrw = Math.trunc(Number(fd.get("depositKrw") ?? 0));
  const agreed = fd.get("agree") === "on";
  if (!agreed) redirect("/dashboard/billing?error=terms");
  if (!Number.isFinite(depositKrw) || depositKrw < MIN_DEPOSIT) redirect("/dashboard/billing?error=amount");

  const { charge, vat } = splitVat(depositKrw);

  // 진행 중(pending) 요청이 이미 있으면 중복 생성 방지 — 하나씩 처리
  const existing = await prisma.topUpRequest.findFirst({ where: { userId, status: "pending" } });
  if (existing) redirect("/dashboard/billing?error=pending");

  await prisma.topUpRequest.create({
    data: { userId, depositKrw, chargeKrw: charge, vatKrw: vat, termsAgreedAt: new Date() },
  });
  revalidatePath("/dashboard/billing");
  redirect("/dashboard/billing?ok=requested");
}

/** 대기 중 충전 요청 취소(고객). */
export async function cancelTopUp(fd: FormData) {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) redirect("/login");
  const id = String(fd.get("id") ?? "");
  // 본인 것 + pending 만 취소
  await prisma.topUpRequest.updateMany({ where: { id, userId, status: "pending" }, data: { status: "canceled" } });
  revalidatePath("/dashboard/billing");
  redirect("/dashboard/billing");
}
