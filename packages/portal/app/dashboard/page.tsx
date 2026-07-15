import Link from "next/link";
import { auth, signOut } from "@/auth";
import { prisma } from "@platform/db";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const email = session?.user?.email ?? "";

  const [acct, keyCount] = userId
    ? await Promise.all([
        prisma.creditAccount.findUnique({ where: { userId } }),
        prisma.apiKey.count({ where: { userId, active: true } }),
      ])
    : [null, 0];

  return (
    <>
      <nav className="topnav">
        <div className="container">
          <span className="brand">CSO API</span>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
            <button className="btn btn-secondary" type="submit">로그아웃</button>
          </form>
        </div>
      </nav>
      <main className="container">
        <section className="hero" style={{ paddingBottom: 16 }}>
          <h1>대시보드</h1>
          <p>{email}</p>
        </section>

        <div className="card" style={{ maxWidth: 480 }}>
          <div className="kv"><span className="k">크레딧 잔액</span><span className="v">{(acct?.balanceKrw ?? 0).toLocaleString()}원</span></div>
          <div className="kv"><span className="k">활성 API 키</span><span className="v">{keyCount}개</span></div>
        </div>

        <h2 className="section-title">빠른 이동</h2>
        <div className="stack">
          <div><Link href="/dashboard/keys">API 키 관리 →</Link></div>
          <div><Link href="/dashboard/usage">호출 이력 →</Link></div>
          <div><Link href="/dashboard/billing">크레딧·충전 →</Link></div>
          <div><Link href="/dashboard/apply">사용 신청(무료 초과) →</Link></div>
        </div>
        <p className="muted" style={{ marginTop: 24 }}>세부 페이지는 다음 단계에서 구현됩니다.</p>
      </main>
    </>
  );
}
