import Link from "next/link";
import { auth, signOut } from "@/auth";

export async function PublicHeader({ fluid = false }: { fluid?: boolean }) {
  const session = await auth();
  const user = session?.user as { role?: string } | undefined;

  return (
    <header className={fluid ? "topnav topnav-fluid" : "topnav"}>
      <div className="container">
        <Link href="/" className="brand" aria-label="나두AI 마켓플레이스 홈">
          <img src="/logo.svg" alt="나두AI" className="brand-logo" />
          <span className="brand-suffix">마켓플레이스</span>
        </Link>
        <nav>
          <Link href="/docs">문서</Link>
          {user ? (
            <>
              {/* 관리자도 사용자(수퍼셋)이므로 대시보드는 노출. 단 관리자 진입점(/admin)은 UI에 링크하지 않음 — 주소 직접 입력으로만 접근 */}
              <Link href="/dashboard">대시보드</Link>
              <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
                <button className="btn btn-sm btn-secondary" type="submit">로그아웃</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login">로그인</Link>
              <Link href="/signup" className="btn btn-sm">무료 시작</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
