import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { confirmTopUp, rejectTopUp } from "./actions";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => new Date(d).toISOString().replace("T", " ").slice(0, 16);
const ST: Record<string, { kind: "success" | "neutral" | "info" | "warning"; label: string }> = {
  pending: { kind: "warning", label: "입금 대기" },
  confirmed: { kind: "success", label: "충전 완료" },
  canceled: { kind: "neutral", label: "취소" },
};

export default async function AdminTopups({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const rows = await prisma.topUpRequest.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { user: { select: { email: true, name: true } } },
  });
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <>
      <div className="page-header"><div><h1>충전 요청</h1><p className="purpose">무통장 입금 확인 후 확정하면 부가세 제외 순액이 잔액에 충전됩니다.</p></div></div>
      {ok === "confirmed" && <div className="flashbar flashbar-success">충전 완료 — 잔액에 반영됐습니다.</div>}
      {ok === "rejected" && <div className="flashbar flashbar-info">요청을 취소했습니다.</div>}
      {error && <div className="flashbar flashbar-error">이미 처리된 요청입니다.</div>}

      <div className="collection">
        <div className="collection-toolbar"><span className="count">입금 대기 <b>{pendingCount}</b>건 · 전체 {rows.length}건</span></div>
        {rows.length === 0 ? (
          <div className="empty-state"><h3>충전 요청이 없습니다</h3></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>요청 시각</th><th>유저</th><th className="num">입금액</th><th className="num">충전액(순액)</th><th className="num">부가세</th><th>상태</th><th className="row-actions">처리</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted mono">{fmt(r.createdAt)}</td>
                  <td className="identity">{r.user?.email}{r.user?.name ? <span className="muted"> ({r.user.name})</span> : null}</td>
                  <td className="num"><b>{r.depositKrw.toLocaleString()}</b></td>
                  <td className="num" style={{ color: "#047857" }}>{r.chargeKrw.toLocaleString()}</td>
                  <td className="num muted">{r.vatKrw.toLocaleString()}</td>
                  <td><StatusBadge kind={ST[r.status]?.kind ?? "neutral"} label={ST[r.status]?.label ?? r.status} /></td>
                  <td className="row-actions">
                    {r.status === "pending" ? (
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <form action={confirmTopUp}><input type="hidden" name="id" value={r.id} /><button className="btn btn-sm" type="submit">확정 충전</button></form>
                        <form action={rejectTopUp}><input type="hidden" name="id" value={r.id} /><button className="btn btn-sm btn-danger" type="submit">취소</button></form>
                      </div>
                    ) : (
                      <span className="muted">{r.confirmedAt ? fmt(r.confirmedAt) : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
