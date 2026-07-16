"use client";
import { useEffect } from "react";

/** 라우트 세그먼트 에러 바운더리 — 서버/클라이언트 오류를 친화적 화면으로 대체(원시 스택 비노출). */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 상세는 콘솔/서버 로그로만 (사용자 화면엔 표시하지 않음)
    console.error(error);
  }, [error]);

  return (
    <div className="auth-wrap" style={{ textAlign: "center" }}>
      <h1>일시적인 오류가 발생했습니다</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button className="btn" onClick={() => reset()}>다시 시도</button>
        <a className="btn btn-secondary" href="/">홈으로</a>
      </div>
      {error.digest && <p className="muted" style={{ marginTop: 20, fontSize: 13 }}>참조 코드: {error.digest}</p>}
    </div>
  );
}
