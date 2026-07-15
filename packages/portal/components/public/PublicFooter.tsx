import Link from "next/link";
import { BRAND } from "@/lib/config";

export function PublicFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div>
          <div style={{ fontWeight: 700 }}>{BRAND}</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>출처: 건강보험심사평가원, 공공누리 제1유형</div>
        </div>
        <div className="links">
          <Link href="/docs">문서</Link>
          <Link href="/login">로그인</Link>
          <Link href="/signup">무료 시작</Link>
        </div>
      </div>
    </footer>
  );
}
