import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@platform/db";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;

  const [acct, keyCount] = userId
    ? await Promise.all([
        prisma.creditAccount.findUnique({ where: { userId } }),
        prisma.apiKey.count({ where: { userId, active: true } }),
      ])
    : [null, 0];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>개요</h1>
          <p className="purpose">계정 현황과 API 사용 시작</p>
        </div>
        <div className="actions">
          <Link href="/dashboard/keys" className="btn btn-sm">API 키 발급</Link>
        </div>
      </div>

      <div className="summary">
        <div className="metric"><div className="label">크레딧 잔액</div><div className="value">{(acct?.balanceKrw ?? 0).toLocaleString()}원</div></div>
        <div className="metric"><div className="label">활성 API 키</div><div className="value">{keyCount}</div></div>
      </div>

      <div className="collection">
        <div className="collection-toolbar"><span className="count">빠른 이동</span></div>
        <table className="tbl">
          <tbody>
            <tr><td className="identity"><Link href="/dashboard/keys">API 키 관리</Link></td><td className="muted">발급·폐기, 호출 인증에 사용</td></tr>
            <tr><td className="identity"><Link href="/dashboard/usage">호출 이력</Link></td><td className="muted">건별 호출·비용 내역</td></tr>
            <tr><td className="identity"><Link href="/dashboard/billing">크레딧·충전</Link></td><td className="muted">잔액·거래 내역, 충전 안내</td></tr>
            <tr><td className="identity"><Link href="/dashboard/apply">사용 신청</Link></td><td className="muted">무료 초과 시 사용 신청</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
