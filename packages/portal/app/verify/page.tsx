import Link from "next/link";
import { PartyPopper } from "lucide-react";
import { prisma } from "@platform/db";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

export const dynamic = "force-dynamic";

type Status = "ok" | "invalid" | "expired";

async function consumeToken(token: string): Promise<Status> {
  const row = await prisma.emailVerificationToken.findUnique({ where: { token } });
  if (!row) return "invalid";
  if (row.expiresAt < new Date()) {
    await prisma.emailVerificationToken.delete({ where: { token } }).catch(() => {});
    return "expired";
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { emailVerified: new Date() } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: row.userId } }),
  ]);
  return "ok";
}

export default async function Verify({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const status: Status = token ? await consumeToken(token) : "invalid";

  return (
    <>
      <PublicHeader />
      <div className="auth-wrap">
        {status === "ok" ? (
          <>
            <h1 style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>인증 완료 <PartyPopper size={24} aria-hidden /></h1>
            <p className="muted" style={{ marginBottom: 24 }}>이메일 인증이 완료되었습니다. 이제 로그인할 수 있습니다.</p>
            <Link href="/login" className="btn" style={{ width: "100%" }}>로그인하러 가기</Link>
          </>
        ) : status === "expired" ? (
          <>
            <h1>링크가 만료되었습니다</h1>
            <p className="muted" style={{ marginBottom: 24 }}>인증 링크는 24시간 후 만료됩니다. 인증 메일을 다시 받아 주세요.</p>
            <Link href="/verify/sent" className="btn btn-secondary" style={{ width: "100%" }}>인증 메일 다시 받기</Link>
          </>
        ) : (
          <>
            <h1>유효하지 않은 링크</h1>
            <p className="muted" style={{ marginBottom: 24 }}>인증 링크가 올바르지 않거나 이미 사용되었습니다.</p>
            <Link href="/login" className="btn btn-secondary" style={{ width: "100%" }}>로그인</Link>
          </>
        )}
      </div>
      <PublicFooter />
    </>
  );
}
