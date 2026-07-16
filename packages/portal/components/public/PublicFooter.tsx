import Link from "next/link";

const CONTACT = "sales@nadoomodoo.com";

export function PublicFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-top">
          {/* 브랜드 + 회사 정보 */}
          <div className="footer-brand">
            <img src="/logo.svg" alt="나두AI" className="footer-logo" />
            <p className="footer-tagline">분야별 실무 API 마켓플레이스</p>
            <address className="footer-company">
              주식회사 나두모두<br />
              서울특별시 강남구 테헤란로 501, 5층 501호 (삼성동, 브이플렉스)<br />
              사업자번호 361-86-02611 · 대표 문영호<br />
              통신판매업신고 2023-서울강남-02876<br />
              02-557-4423 · <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
            </address>
          </div>

          {/* 링크 컬럼 */}
          <div className="footer-cols">
            <div className="footer-col">
              <h4>서비스</h4>
              <Link href="/">API 카탈로그</Link>
              <Link href="/docs">API 문서</Link>
              <Link href="/dashboard">대시보드</Link>
            </div>
            <div className="footer-col">
              <h4>계정</h4>
              <Link href="/login">로그인</Link>
              <Link href="/signup">무료 시작</Link>
              <Link href="/dashboard/keys">API 키</Link>
            </div>
            <div className="footer-col">
              <h4>지원</h4>
              <Link href="/dashboard/apply">사용 신청</Link>
              <a href={`mailto:${CONTACT}`}>이메일 문의</a>
            </div>
          </div>
        </div>

        {/* 정보보호 인증 */}
        <div className="footer-iso">
          <img src="/iso_mark.webp" alt="ISO/IEC 27001 인증" className="footer-iso-mark" />
          <span className="muted">정보보호 국제표준 <b style={{ color: "#cbd5e1", fontWeight: 700 }}>ISO/IEC 27001</b> 인증 — 고객 데이터를 안전하게 보호합니다.</span>
        </div>

        {/* 하단 카피/법적 */}
        <div className="footer-bottom">
          <span className="muted">© 2026 나두AI · 주식회사 나두모두. All rights reserved.</span>
          <div className="footer-legal">
            <a href={`mailto:${CONTACT}`}>문의</a>
            <Link href="/docs">문서</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
