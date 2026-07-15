/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prisma/공유 DB 패키지는 서버 번들에서 외부 모듈로 유지
  serverExternalPackages: ["@platform/db", "@prisma/client", ".prisma/client"],
};
export default nextConfig;
