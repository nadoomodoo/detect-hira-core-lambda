import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "CSO API — HIRA 약가코드 검출",
  description: "처방전 이미지에서 약가코드를 검출해 제약사를 태깅하는 API",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
