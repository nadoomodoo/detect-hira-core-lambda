import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { prisma } from "@platform/db";
import { signIn } from "@/auth";
import { verifyPassword } from "@/lib/password";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function doLogin(fd: FormData) {
    "use server";
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const password = String(fd.get("password") ?? "");
    // 비번은 맞지만 미인증인 경우, 일반 오류 대신 인증 안내로 보내 재발송을 돕는다.
    const u = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true, emailVerified: true } });
    if (u?.passwordHash && verifyPassword(password, u.passwordHash) && !u.emailVerified) {
      redirect(`/verify/sent?email=${encodeURIComponent(email)}`);
    }
    try {
      await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    } catch (e) {
      if (e instanceof AuthError) redirect("/login?error=credentials");
      throw e; // 성공 시 NEXT_REDIRECT 전파
    }
  }

  return (
    <>
      <PublicHeader />
      <div className="auth-wrap">
      <h1>로그인</h1>
      {error && (
        <p style={{ color: "#dc2626", fontSize: 14, marginBottom: 12 }}>
          이메일 또는 비밀번호가 올바르지 않습니다.
        </p>
      )}

      <form className="stack" action={doLogin}>
        <div className="field">
          <label>이메일</label>
          <input name="email" type="email" required autoComplete="email" />
        </div>
        <div className="field">
          <label>비밀번호</label>
          <input name="password" type="password" required autoComplete="current-password" />
        </div>
        <button className="btn" type="submit" style={{ width: "100%" }}>로그인</button>
      </form>

      <p className="muted" style={{ marginTop: 20, textAlign: "center" }}>
        계정이 없으신가요? <Link href="/signup">회원가입</Link>
      </p>
      </div>
      <PublicFooter />
    </>
  );
}
