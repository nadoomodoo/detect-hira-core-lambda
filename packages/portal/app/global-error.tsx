"use client";
import { useEffect } from "react";

/** 루트 레이아웃까지 실패한 경우의 최후 바운더리 — 자체 html/body 필요. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="ko">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>일시적인 오류가 발생했습니다</h1>
          <p style={{ color: "#6b7280", margin: "12px 0 24px" }}>잠시 후 다시 시도해 주세요.</p>
          <button onClick={() => reset()} style={{ height: 44, padding: "0 20px", borderRadius: 9, background: "#4f46e5", color: "#fff", border: "none", cursor: "pointer", fontSize: 16 }}>다시 시도</button>
        </div>
      </body>
    </html>
  );
}
