import Link from "next/link";
import { signIn } from "@/auth";

export default function AdminLogin() {
  return (
    <div className="auth-wrap">
      <h1>관리자 로그인</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        nadoomodoo.com 직원 Google 계정만 접근할 수 있습니다.
      </p>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/admin" });
        }}
      >
        <button className="btn" type="submit" style={{ width: "100%" }}>
          Google로 로그인
        </button>
      </form>

      <p className="muted" style={{ marginTop: 20, textAlign: "center" }}>
        <Link href="/login">← 고객 로그인</Link>
      </p>
    </div>
  );
}
