import Link from "next/link";

export function PublicHeader({ fluid = false }: { fluid?: boolean }) {
  return (
    <header className={fluid ? "topnav topnav-fluid" : "topnav"}>
      <div className="container">
        <Link href="/" className="brand" aria-label="나두AI 마켓플레이스 홈">
          <img src="/logo.svg" alt="나두AI" className="brand-logo" />
          <span className="brand-suffix">마켓플레이스</span>
        </Link>
        <nav>
          <Link href="/docs">문서</Link>
          <Link href="/login">로그인</Link>
          <Link href="/signup" className="btn btn-sm">무료 시작</Link>
        </nav>
      </div>
    </header>
  );
}
