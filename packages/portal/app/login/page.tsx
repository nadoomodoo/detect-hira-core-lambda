import { signIn } from "@/auth";

export default function Login() {
  return (
    <div className="auth-wrap">
      <h1>로그인</h1>

      <form
        className="stack"
        action={async (fd: FormData) => {
          "use server";
          await signIn("credentials", {
            email: String(fd.get("email") ?? ""),
            password: String(fd.get("password") ?? ""),
            redirectTo: "/dashboard",
          });
        }}
      >
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

      <div className="divider">— 또는 —</div>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/admin" });
        }}
      >
        <button className="btn btn-secondary" type="submit" style={{ width: "100%" }}>
          Google로 로그인 (직원)
        </button>
      </form>
    </div>
  );
}
