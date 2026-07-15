import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/console/AppShell";
import "../console.css";

const NAV = [
  { href: "/dashboard", label: "개요" },
  { href: "/dashboard/keys", label: "API 키" },
  { href: "/dashboard/usage", label: "호출 이력" },
  { href: "/dashboard/billing", label: "크레딧" },
  { href: "/dashboard/apply", label: "사용 신청" },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return (
    <AppShell brand="CSO API" userEmail={session?.user?.email ?? ""} items={NAV}>
      {children}
    </AppShell>
  );
}
