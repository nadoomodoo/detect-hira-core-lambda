import { auth } from "@/auth";
import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Pager } from "@/components/console/Pager";
import { fmtKST } from "@/lib/datetime";
import { TopUp } from "./TopUp";
import { cancelTopUp } from "./actions";

export const dynamic = "force-dynamic";

// 입금 계좌 (자가발행 무통장 입금)
const BANK = { name: "신한은행", account: "140-013-780729", holder: "(주)나두모두" };

const fmt = fmtKST;
const TX: Record<string, { kind: "success" | "neutral" | "info"; label: string }> = {
  TOPUP: { kind: "success", label: "충전" },
  CHARGE: { kind: "neutral", label: "과금" },
  REFUND: { kind: "info", label: "환불" },
};

const ERRORS: Record<string, string> = {
  amount: "최소 입금 금액은 11,000원입니다.",
  terms: "환불 약관에 동의해 주세요.",
  pending: "이미 진행 중인 충전 요청이 있습니다. 입금 완료 또는 취소 후 다시 시도해 주세요.",
};

const PAGE_SIZE = 100;

export default async function Billing({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; page?: string }> }) {
  const { ok, error, page } = await searchParams;
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const [acct, txCount, pending] = userId
    ? await Promise.all([
        prisma.creditAccount.findUnique({ where: { userId } }),
        prisma.creditTx.count({ where: { userId } }),
        prisma.topUpRequest.findFirst({ where: { userId, status: "pending" }, orderBy: { createdAt: "desc" } }),
      ])
    : [null, 0, null];
  const pageCount = Math.max(1, Math.ceil(txCount / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const txs = userId
    ? await prisma.creditTx.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE })
    : [];
  const qs = (p: number) => `?page=${p}`;

  return (
    <>
      <div className="page-header">
        <div><h1>잔액</h1><p className="purpose">잔액과 거래 내역. 입금 확인 후 부가세를 제외한 금액이 충전됩니다.</p></div>
        <div className="actions"><TopUp hasPending={!!pending} /></div>
      </div>

      {ok === "requested" && <div className="flashbar flashbar-success">충전 요청이 접수됐어요. 아래 계좌로 입금해 주세요.</div>}
      {error && <div className="flashbar flashbar-error">{ERRORS[error] ?? "요청을 처리하지 못했습니다."}</div>}

      <div className="summary">
        <div className="metric"><div className="label">현재 잔액</div><div className="value">{(acct?.balanceKrw ?? 0).toLocaleString()}원</div></div>
      </div>

      {pending ? (
        <div className="collection">
          <div className="collection-toolbar"><span className="count">입금 대기중</span></div>
          <div className="topup-pending">
            <p className="topup-pending-guide">아래 계좌로 <b>{pending.depositKrw.toLocaleString()}원</b>을 입금해 주세요. 입금 확인 후 <b>{pending.chargeKrw.toLocaleString()}원</b>(부가세 {pending.vatKrw.toLocaleString()}원 제외)이 잔액에 충전됩니다.</p>
            <div className="bank-box">
              <div><span>은행</span><b>{BANK.name}</b></div>
              <div><span>계좌번호</span><b className="mono">{BANK.account}</b></div>
              <div><span>예금주</span><b>{BANK.holder}</b></div>
              <div><span>입금액</span><b className="bank-amount">{pending.depositKrw.toLocaleString()}원</b></div>
            </div>
            <p className="topup-notes">
              · 입금자명을 <b>가입 이메일 또는 이름</b>으로 맞춰 주시면 확인이 빨라요.<br />
              · 입금 확인은 영업일 기준 수 시간 내 처리되며, 확인되면 잔액에 자동 반영됩니다.
            </p>
            <div className="topup-cancel">
              <form action={cancelTopUp}>
                <input type="hidden" name="id" value={pending.id} />
                <button type="submit" className="btn btn-sm btn-secondary">요청 취소</button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <div className="flashbar flashbar-info">
          <b>잔액 추가</b>는 무통장 입금으로 진행됩니다. 우측 상단 <b>+ 잔액 추가</b>에서 금액을 입력하고 약관에 동의하면 입금 계좌가 안내됩니다. (자동 결제는 추후 지원)
        </div>
      )}

      <div className="collection">
        <div className="collection-toolbar"><span className="count">총 <b>{txCount.toLocaleString()}</b>건 거래 · {current}/{pageCount} 페이지</span></div>
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
        <Pager current={current} pageCount={pageCount} makeHref={qs} />
      </div>
    </>
  );
}
