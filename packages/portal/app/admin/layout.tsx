import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/console/AppShell";
import "../console.css";

const NAV = [
  { href: "/admin", label: "개요" },
  { href: "/admin/products", label: "프로덕트" },
  { href: "/admin/users", label: "유저·충전" },
  { href: "/admin/topups", label: "충전 요청" },
  { href: "/admin/credits", label: "거래 원장" },
  { href: "/admin/requests", label: "사용 신청" },
  { href: "/admin/comarketing", label: "코마케팅" },
  { href: "/admin/master", label: "약가 마스터" },
  { href: "/admin/usage", label: "호출이력·정산" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  // 비인증(/admin/login 등)은 셸 없이 렌더
  if (role !== "ADMIN") return <>{children}</>;
  return (
    <AppShell brand="관리자" userEmail={session?.user?.email ?? ""} items={NAV}>
      {children}
    </AppShell>
  );
}
