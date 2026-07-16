import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@platform/db";
import { verifyPassword } from "@/lib/password";
import authConfig from "@/auth.config";

const ADMIN_HD = process.env.ADMIN_HD ?? "nadoomodoo.com";

/**
 * 전체 인증(Node 런타임) — Edge-safe authConfig 를 확장해
 * Credentials(비밀번호 검증, Prisma) + jwt(Google 어드민 upsert, Prisma) 추가.
 * 미들웨어는 auth.config.ts 만 사용(Prisma/crypto 없음).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = String(creds?.email ?? "");
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        const u = await prisma.user.findUnique({ where: { email } });
        if (!u?.passwordHash || !verifyPassword(password, u.passwordHash)) return null;
        if (!u.emailVerified) return null; // 이메일 미인증 계정은 로그인 차단
        return { id: u.id, email: u.email, name: u.name ?? undefined, role: u.role };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "google" && (profile as any)?.hd === ADMIN_HD) {
        const email = token.email!;
        const dbu = await prisma.user.upsert({
          where: { email },
          // Google(회사 도메인) 로그인은 도메인 검증으로 신원이 확인되므로 즉시 인증 처리
          create: { email, name: token.name, role: "ADMIN", emailVerified: new Date(), credit: { create: {} } },
          update: { role: "ADMIN", emailVerified: new Date() },
        });
        (token as any).role = "ADMIN";
        (token as any).uid = dbu.id;
        (token as any).hd = ADMIN_HD;
      } else if (user) {
        (token as any).role = (user as any).role;
        (token as any).uid = (user as any).id;
      }
      return token;
    },
  },
});
