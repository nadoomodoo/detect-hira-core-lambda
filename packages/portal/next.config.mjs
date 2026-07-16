import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // 모노레포: 워크스페이스 의존까지 트레이싱하도록 루트 지정
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  // Prisma/공유 DB 패키지는 서버 번들에서 외부 모듈로 유지
  serverExternalPackages: ["@platform/db", "@prisma/client", ".prisma/client", "exceljs"],
  // 약가 마스터 CSV 업로드(수만 행) 대비 서버액션 바디 한도 상향
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};
export default nextConfig;
