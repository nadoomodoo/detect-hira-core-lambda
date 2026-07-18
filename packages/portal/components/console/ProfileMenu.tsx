"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * 상단 우측 프로필 메뉴 (SaaS 스타일 팝오버).
 * 이메일(아바타)을 클릭하면 계정 설정·로그아웃이 팝오버로 뜬다.
 * signOutAction 은 서버 컴포넌트(AppShell)에서 서버액션으로 주입.
 */
export function ProfileMenu({
  email,
  accountHref,
  signOutAction,
}: {
  email: string;
  accountHref?: string;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const initial = (email.trim()[0] || "?").toUpperCase();

  return (
    <div className="profile-menu" ref={ref}>
      <button type="button" className="profile-trigger" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <span className="profile-avatar" aria-hidden>{initial}</span>
        <span className="profile-email">{email}</span>
        <span className={`profile-caret${open ? " open" : ""}`} aria-hidden>▾</span>
      </button>

      {open && (
        <div className="profile-popover" role="menu">
          <div className="profile-popover-head">
            <div className="profile-avatar lg" aria-hidden>{initial}</div>
            <div className="profile-popover-email">{email}</div>
          </div>
          <div className="profile-popover-sep" />
          {accountHref && (
            <Link href={accountHref} className="profile-item" role="menuitem" onClick={() => setOpen(false)}>
              계정 설정
            </Link>
          )}
          <form action={signOutAction}>
            <button type="submit" className="profile-item danger" role="menuitem">로그아웃</button>
          </form>
        </div>
      )}
    </div>
  );
}
