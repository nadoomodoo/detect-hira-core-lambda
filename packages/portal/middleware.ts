import NextAuth from "next-auth";
import authConfig from "@/auth.config";

// Edge-safe 설정만으로 미들웨어 구성 (Prisma/crypto 미포함)
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*"],
};
