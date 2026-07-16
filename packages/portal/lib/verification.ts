import { randomBytes } from "node:crypto";
import { prisma } from "@platform/db";

/**
 * 이메일 인증 토큰 생성 + Resend 발송.
 * 시크릿(RESEND_API_KEY)은 환경변수로만 주입 — 코드/깃에 넣지 말 것.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24시간
const MAIL_FROM = process.env.MAIL_FROM ?? "나두AI 마켓플레이스 <no-reply@market.nadoo.ai>";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/** 유저의 기존 미사용 토큰을 정리하고 새 토큰을 발급해 인증 메일을 보낸다. */
export async function createAndSendVerification(userId: string, email: string): Promise<void> {
  await prisma.emailVerificationToken.deleteMany({ where: { userId } });

  const token = randomBytes(32).toString("base64url");
  await prisma.emailVerificationToken.create({
    data: { token, userId, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });

  const verifyUrl = `${APP_URL}/verify?token=${encodeURIComponent(token)}`;
  await sendMail(email, verifyUrl);
}

async function sendMail(to: string, verifyUrl: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // 로컬/개발: Resend 키 없으면 발송 대신 콘솔에 링크 출력(가입 흐름 비차단).
    // 운영에서는 키 필수 — 미설정 시 실제 메일이 나가지 않음.
    console.log(`\n📧 [DEV] 이메일 인증 링크 (${to}):\n${verifyUrl}\n`);
    return;
  }

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111827">
      <h1 style="font-size:20px;margin:0 0 16px">이메일 인증</h1>
      <p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 24px">
        나두AI 마켓플레이스 가입을 완료하려면 아래 버튼을 눌러 이메일을 인증해 주세요.
        이 링크는 24시간 후 만료됩니다.
      </p>
      <a href="${verifyUrl}" style="display:inline-block;background:#385AF0;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:9px">이메일 인증하기</a>
      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:24px 0 0">
        버튼이 동작하지 않으면 아래 주소를 브라우저에 붙여넣으세요.<br>
        <span style="word-break:break-all">${verifyUrl}</span>
      </p>
      <p style="font-size:12px;color:#9ca3af;margin:24px 0 0">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to,
      subject: "[나두AI] 이메일을 인증해 주세요",
      html,
    }),
  });

  if (!res.ok) {
    throw new Error(`resend_failed_${res.status}:${await res.text()}`);
  }
}
