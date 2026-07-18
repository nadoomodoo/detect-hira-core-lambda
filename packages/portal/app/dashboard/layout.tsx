import type { ReactNode } from "react";
import { auth } from "@/auth";
import { AppShell } from "@/components/console/AppShell";
import "../console.css";

// 사용 신청은 마켓플레이스에서 접근, 계정 설정은 우측 상단 프로필 팝오버로 이동(사이드 메뉴에서 제외)
const NAV = [
  { href: "/dashboard", label: "홈" },
  { href: "/dashboard/marketplace", label: "마켓플레이스" },
  { href: "/dashboard/extract-batch", label: "배치 추출" },
  { href: "/dashboard/keys", label: "API 키" },
  { href: "/dashboard/usage", label: "사용량" },
  { href: "/dashboard/billing", label: "잔액" },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return (
    <AppShell brand="대시보드" userEmail={session?.user?.email ?? ""} items={NAV} accountHref="/dashboard/account">
      {children}
    </AppShell>
  );
}
