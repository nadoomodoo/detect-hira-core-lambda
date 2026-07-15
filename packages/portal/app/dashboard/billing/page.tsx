import { auth } from "@/auth";
import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => new Date(d).toISOString().replace("T", " ").slice(0, 16);
const TX: Record<string, { kind: "success" | "neutral" | "info"; label: string }> = {
  TOPUP: { kind: "success", label: "충전" },
  CHARGE: { kind: "neutral", label: "과금" },
  REFUND: { kind: "info", label: "환불" },
};

export default async function Billing() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const [acct, txs] = userId
    ? await Promise.all([
        prisma.creditAccount.findUnique({ where: { userId } }),
        prisma.creditTx.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
      ])
    : [null, []];

  return (
    <>
      <div className="page-header"><div><h1>크레딧</h1><p className="purpose">잔액과 거래 내역. 충전은 입금 확인 후 반영됩니다.</p></div></div>

      <div className="summary">
        <div className="metric"><div className="label">현재 잔액</div><div className="value">{(acct?.balanceKrw ?? 0).toLocaleString()}원</div></div>
      </div>

      <div className="flashbar flashbar-info">
        충전 안내: 원하는 금액을 입금 후 담당자에게 알려주시면 잔액에 반영됩니다. (자동 결제는 추후 지원)
      </div>

      <div className="collection">
        <div className="collection-toolbar"><span className="count"><b>{txs.length}</b>건 거래</span></div>
        {txs.length === 0 ? (
          <div className="empty-state"><h3>거래 내역이 없습니다</h3></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>시각</th><th>유형</th><th className="num">금액(원)</th><th>메모</th></tr></thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td className="muted mono">{fmt(t.createdAt)}</td>
                  <td><StatusBadge kind={TX[t.type]?.kind ?? "neutral"} label={TX[t.type]?.label ?? t.type} /></td>
                  <td className="num" style={{ color: t.deltaKrw >= 0 ? "#047857" : "var(--text)" }}>{t.deltaKrw >= 0 ? "+" : ""}{t.deltaKrw.toLocaleString()}</td>
                  <td className="muted">{t.memo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
