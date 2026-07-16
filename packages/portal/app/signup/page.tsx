import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@platform/db";
import { hashPassword } from "@/lib/password";
import { createAndSendVerification } from "@/lib/verification";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

const ERRORS: Record<string, string> = {
  invalid: "이메일 형식과 8자 이상 비밀번호를 입력하세요.",
  taken: "이미 가입된 이메일입니다.",
  mail: "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
};

export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function doSignup(fd: FormData) {
    "use server";
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const password = String(fd.get("password") ?? "");
    const name = String(fd.get("name") ?? "").trim();
    if (!email.includes("@") || password.length < 8) redirect("/signup?error=invalid");
    if (await prisma.user.findUnique({ where: { email } })) redirect("/signup?error=taken");
    const user = await prisma.user.create({
      data: { email, name: name || null, passwordHash: hashPassword(password), credit: { create: { balanceKrw: 0 } } },
      select: { id: true, email: true },
    });
    // 인증 메일 발송 실패 시 가입 자체를 롤백해 "인증 못 하는 유령 계정"을 남기지 않는다.
    try {
      await createAndSendVerification(user.id, user.email);
    } catch (e) {
      console.error("SIGNUP_MAIL_ERR", e);
      await prisma.user.delete({ where: { id: user.id } });
      redirect("/signup?error=mail");
    }
    redirect(`/verify/sent?email=${encodeURIComponent(email)}`);
  }

  return (
    <>
      <PublicHeader />
      <div className="auth-wrap">
      <h1>회원가입</h1>
      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{ERRORS[error] ?? "오류가 발생했습니다."}</p>}
      <form className="stack" action={doSignup}>
        <div className="field"><label>이름 (선택)</label><input name="name" type="text" /></div>
        <div className="field"><label>이메일</label><input name="email" type="email" required autoComplete="email" /></div>
        <div className="field"><label>비밀번호 (8자 이상)</label><input name="password" type="password" required minLength={8} autoComplete="new-password" /></div>
        <button className="btn" type="submit" style={{ width: "100%" }}>가입하기</button>
      </form>
      <p className="muted" style={{ marginTop: 20, textAlign: "center" }}>
        이미 계정이 있으신가요? <Link href="/login">로그인</Link>
      </p>
      </div>
      <PublicFooter />
    </>
  );
}
