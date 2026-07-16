import Link from "next/link";

/** 404 — 친화적 안내(원시 노출 방지). */
export default function NotFound() {
  return (
    <div className="auth-wrap" style={{ textAlign: "center" }}>
      <h1>페이지를 찾을 수 없습니다</h1>
      <p className="muted" style={{ marginBottom: 24 }}>주소가 바뀌었거나 삭제된 페이지일 수 있습니다.</p>
      <Link className="btn" href="/">홈으로</Link>
    </div>
  );
}
