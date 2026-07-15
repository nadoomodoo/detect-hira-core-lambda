import Link from "next/link";
import { BRAND } from "@/lib/config";

export function PublicHeader() {
  return (
    <header className="topnav">
      <div className="container">
        <Link href="/" className="brand">{BRAND}</Link>
        <nav>
          <Link href="/docs">문서</Link>
          <Link href="/login">로그인</Link>
          <Link href="/signup" className="btn btn-sm">무료 시작</Link>
        </nav>
      </div>
    </header>
  );
}
