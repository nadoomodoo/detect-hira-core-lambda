import Link from "next/link";
import { prisma } from "@platform/db";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const [users, products, pendingReqs] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.accessRequest.count({ where: { status: "NEW" } }),
  ]).catch(() => [0, 0, 0]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>개요</h1>
          <p className="purpose">시스템 현황</p>
        </div>
      </div>

      <div className="summary">
        <div className="metric"><div className="label">총 유저</div><div className="value">{users}</div></div>
        <div className="metric"><div className="label">프로덕트</div><div className="value">{products}</div></div>
        <div className="metric"><div className="label">대기 중 신청</div><div className="value">{pendingReqs}</div></div>
      </div>

      <div className="collection">
        <div className="collection-toolbar"><span className="count">관리</span></div>
        <table className="tbl">
          <tbody>
            <tr><td className="identity"><Link href="/admin/products">프로덕트</Link></td><td className="muted">가격·무료쿼터·상태·processorUrl</td></tr>
            <tr><td className="identity"><Link href="/admin/users">유저·수동 충전</Link></td><td className="muted">잔액 조정, Entitlement</td></tr>
            <tr><td className="identity"><Link href="/admin/requests">사용 신청</Link></td><td className="muted">무료 초과 신청 처리</td></tr>
            <tr><td className="identity"><Link href="/admin/comarketing">코마케팅 매핑</Link></td><td className="muted">약가코드 표기 오버라이드</td></tr>
            <tr><td className="identity"><Link href="/admin/master">약가 마스터</Link></td><td className="muted">약가코드→제약사 검색·CSV 업로드</td></tr>
            <tr><td className="identity"><Link href="/admin/usage">호출이력·정산</Link></td><td className="muted">BigQuery 집계</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
