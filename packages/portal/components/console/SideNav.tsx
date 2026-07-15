"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem { href: string; label: string; }

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <aside className="console-side">
      {items.map((it) => {
        const active = path === it.href || (it.href !== "/dashboard" && it.href !== "/admin" && path.startsWith(it.href + "/"));
        return (
          <Link key={it.href} href={it.href} className={active ? "active" : ""}>
            {it.label}
          </Link>
        );
      })}
    </aside>
  );
}
