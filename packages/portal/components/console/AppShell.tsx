import Link from "next/link";
import { signOut } from "@/auth";
import { SideNav, type NavItem } from "./SideNav";
import { ProfileMenu } from "./ProfileMenu";
import type { ReactNode } from "react";

export function AppShell({
  brand,
  items,
  userEmail,
  accountHref,
  children,
}: {
  brand: string;
  items: NavItem[];
  userEmail: string;
  accountHref?: string;
  children: ReactNode;
}) {
  return (
    <div className="console-shell">
      <header className="console-top">
        <Link href="/" className="brand" aria-label="나두AI 홈">
          <img src="/logo.svg" alt="나두AI" className="brand-logo" />
          <span className="brand-suffix">{brand}</span>
        </Link>
        <ProfileMenu
          email={userEmail}
          accountHref={accountHref}
          signOutAction={async () => { "use server"; await signOut({ redirectTo: "/" }); }}
        />
      </header>
      <SideNav items={items} />
      <main className="console-main">{children}</main>
    </div>
  );
}
