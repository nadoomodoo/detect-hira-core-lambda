import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "제약 CSO API 마켓플레이스",
  description: "제약 영업·유통(CSO) 업무에 필요한 API를 한 곳에서. API 키 하나로 바로 호출하세요.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
