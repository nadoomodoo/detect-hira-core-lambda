import { auth } from "@/auth";

/**
 * 어드민 메뉴별 권한 — 슈퍼어드민 전용 메뉴 제어.
 * 슈퍼어드민은 하드코딩된 단일 계정(admin@nadoomodoo.com). 별도 역할/테이블 없음.
 */
export const SUPER_ADMIN_EMAIL = "admin@nadoomodoo.com";

/** 슈퍼어드민 전용 라우트(prefix). 일반 ADMIN은 접근 불가(메뉴 숨김 + 라우트 차단). */
export const SUPER_ADMIN_PATHS = ["/admin/costs", "/admin/cost-analysis"] as const;

export function isSuperAdminEmail(email?: string | null): boolean {
  return (email ?? "").toLowerCase() === SUPER_ADMIN_EMAIL;
}

/** 해당 경로가 슈퍼어드민 전용인지. */
export function isSuperAdminPath(href: string): boolean {
  return SUPER_ADMIN_PATHS.some((p) => href === p || href.startsWith(p + "/"));
}

/** 현재 세션이 슈퍼어드민인지(서버). */
export async function isSuperAdmin(): Promise<boolean> {
  const session = await auth();
  return isSuperAdminEmail(session?.user?.email);
}

/**
 * 슈퍼어드민 전용 페이지 가드 — 아니면 not-found로 위장(존재 노출 방지).
 * 페이지 컴포넌트 최상단에서 `await requireSuperAdmin()` 호출.
 */
export async function requireSuperAdmin(): Promise<void> {
  if (!(await isSuperAdmin())) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
}
