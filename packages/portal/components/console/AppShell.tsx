import Link from "next/link";
import { signOut } from "@/auth";
import { SideNav, type NavItem } from "./SideNav";
import type { ReactNode } from "react";

export function AppShell({
  brand,
  items,
  userEmail,
  children,
}: {
  brand: string;
  items: NavItem[];
  userEmail: string;
  children: ReactNode;
}) {
  return (
    <div className="console-shell">
      <header className="console-top">
        <Link href="/" className="brand" aria-label="나두AI 홈">
          <img src="/logo.svg" alt="나두AI" className="brand-logo" />
          <span className="brand-suffix">{brand}</span>
        </Link>
        <div className="profile">
          <span>{userEmail}</span>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
            <button className="btn btn-secondary btn-sm" type="submit">로그아웃</button>
          </form>
        </div>
      </header>
      <SideNav items={items} />
      <main className="console-main">{children}</main>
    </div>
  );
}
