import Link from "next/link";
import { auth, signOut } from "@/auth";

export const dynamic = "force-dynamic";

export default async function Admin() {
  const session = await auth();
  const email = session?.user?.email ?? "";

  return (
    <>
      <nav className="topnav">
        <div className="container">
          <span className="brand">CSO API · 관리자</span>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
            <button className="btn btn-secondary" type="submit">로그아웃</button>
          </form>
        </div>
      </nav>
      <main className="container">
        <section className="hero" style={{ paddingBottom: 16 }}>
          <h1>관리자 콘솔</h1>
          <p>{email} (nadoomodoo.com)</p>
        </section>
        <h2 className="section-title">관리</h2>
        <div className="stack">
          <div><Link href="/admin/products">프로덕트 (가격·무료쿼터·상태) →</Link></div>
          <div><Link href="/admin/users">유저·수동 충전 →</Link></div>
          <div><Link href="/admin/requests">사용 신청 →</Link></div>
          <div><Link href="/admin/comarketing">코마케팅 매핑 →</Link></div>
          <div><Link href="/admin/usage">호출이력·정산 →</Link></div>
        </div>
        <p className="muted" style={{ marginTop: 24 }}>세부 화면은 design.md 표준으로 다음 단계에서 구현됩니다.</p>
      </main>
    </>
  );
}
