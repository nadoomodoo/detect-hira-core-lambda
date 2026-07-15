import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

const ADMIN_HD = process.env.ADMIN_HD ?? "nadoomodoo.com";

/**
 * Edge-safe 설정 (미들웨어용) — node:crypto·Prisma 미포함.
 * Credentials(비밀번호 검증)·jwt(Prisma upsert)는 auth.ts(Node)에서 확장.
 */
export default {
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "google") return (profile as any)?.hd === ADMIN_HD;
      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = (token as any).role;
        (session.user as any).id = (token as any).uid;
        (session.user as any).hd = (token as any).hd;
      }
      return session;
    },
    authorized({ request, auth }) {
      const { pathname } = request.nextUrl;
      const u = auth?.user as any;
      if (pathname.startsWith("/admin")) return u?.role === "ADMIN" && u?.hd === ADMIN_HD;
      if (pathname.startsWith("/dashboard")) return !!auth?.user;
      return true;
    },
  },
} satisfies NextAuthConfig;
