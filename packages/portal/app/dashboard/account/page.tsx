import { auth } from "@/auth";
import { changePassword } from "./actions";

export const dynamic = "force-dynamic";

const ERR: Record<string, string> = {
  short: "새 비밀번호는 8자 이상이어야 합니다.",
  mismatch: "새 비밀번호와 확인이 일치하지 않습니다.",
  current: "현재 비밀번호가 올바르지 않습니다.",
  nopw: "이 계정은 Google 로그인 계정이라 비밀번호를 변경할 수 없습니다.",
};

export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const session = await auth();
  const email = session?.user?.email ?? "";

  return (
    <>
      <div className="page-header"><div><h1>계정 설정</h1><p className="purpose">로그인 정보와 비밀번호를 관리해요.</p></div></div>

      {ok && <div className="flashbar flashbar-success">비밀번호가 변경되었습니다.</div>}
      {error && <div className="flashbar flashbar-error">{ERR[error] ?? "변경에 실패했습니다."}</div>}

      <div className="collection" style={{ marginBottom: 20 }}>
        <div className="collection-toolbar"><span className="count">내 정보</span></div>
        <table className="tbl">
          <tbody>
            <tr><td className="identity">이메일</td><td>{email}</td></tr>
          </tbody>
        </table>
      </div>

      <form className="form-section stack" action={changePassword}>
        <h3 style={{ fontWeight: 700 }}>비밀번호 변경</h3>
        <div className="field"><label>현재 비밀번호</label><input name="current" type="password" required autoComplete="current-password" /></div>
        <div className="field"><label>새 비밀번호 (8자 이상)</label><input name="next" type="password" required minLength={8} autoComplete="new-password" /></div>
        <div className="field"><label>새 비밀번호 확인</label><input name="confirm" type="password" required minLength={8} autoComplete="new-password" /></div>
        <button className="btn btn-sm" type="submit">비밀번호 변경</button>
      </form>
    </>
  );
}
