import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@platform/db";
import { createAndSendVerification } from "@/lib/verification";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

export default async function VerifySent({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; resent?: string }>;
}) {
  const { email, resent } = await searchParams;

  async function resend(fd: FormData) {
    "use server";
    const addr = String(fd.get("email") ?? "").trim().toLowerCase();
    // 계정 존재 여부를 노출하지 않도록, 미인증 유저일 때만 실제 발송하고 결과는 항상 동일하게 응답한다.
    const user = await prisma.user.findUnique({ where: { email: addr }, select: { id: true, email: true, emailVerified: true } });
    if (user && !user.emailVerified) {
      try {
        await createAndSendVerification(user.id, user.email);
      } catch (e) {
        console.error("RESEND_MAIL_ERR", e);
      }
    }
    redirect(`/verify/sent?email=${encodeURIComponent(addr)}&resent=1`);
  }

  return (
    <>
      <PublicHeader />
      <div className="auth-wrap">
        <h1>메일함을 확인해 주세요</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          {email ? <b>{email}</b> : "가입하신 이메일"} 주소로 인증 링크를 보냈습니다.
          메일의 <b>이메일 인증하기</b> 버튼을 눌러 가입을 완료하세요. 링크는 24시간 후 만료됩니다.
        </p>
        {resent && (
          <p style={{ color: "#059669", fontSize: 14, marginBottom: 12 }}>인증 메일을 다시 보냈습니다.</p>
        )}
        <form className="stack" action={resend}>
          <input type="hidden" name="email" value={email ?? ""} />
          <button className="btn btn-secondary" type="submit" style={{ width: "100%" }}>인증 메일 다시 받기</button>
        </form>
        <p className="muted" style={{ marginTop: 20, textAlign: "center" }}>
          인증을 마치셨나요? <Link href="/login">로그인</Link>
        </p>
      </div>
      <PublicFooter />
    </>
  );
}
