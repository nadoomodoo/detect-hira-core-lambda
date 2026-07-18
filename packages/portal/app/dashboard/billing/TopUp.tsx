"use client";
import { useEffect, useState } from "react";
import { createTopUp } from "./actions";

/** 잔액 추가(무통장 입금) — 버튼 + 모달. 금액 입력 + 부가세 미리보기 + 환불약관 동의 → 요청 생성. */
export function TopUp({ hasPending }: { hasPending: boolean }) {
  const [open, setOpen] = useState(false);
  const [deposit, setDeposit] = useState("");
  const [agree, setAgree] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open]);

  const amount = Math.trunc(Number(deposit) || 0);
  const charge = amount > 0 ? Math.round(amount / 1.1) : 0;
  const vat = amount - charge;
  const valid = amount >= 11000 && agree;

  if (hasPending) return null; // 진행 중 요청이 있으면 새 요청 버튼 숨김

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>+ 잔액 추가</button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-panel" role="dialog" aria-modal="true" aria-label="잔액 추가" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>잔액 추가</h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>무통장 입금 · 입금 확인 후 부가세를 제외한 금액이 충전됩니다.</p>
              </div>
              <button type="button" className="modal-close" aria-label="닫기" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <form action={createTopUp}>
                <div className="topup-row">
                  <label>입금 금액 (부가세 포함)</label>
                  <div className="topup-input">
                    <input
                      name="depositKrw" type="number" min={11000} step={1000} inputMode="numeric"
                      placeholder="예: 110,000" value={deposit} onChange={(e) => setDeposit(e.target.value)} autoFocus required
                    />
                    <span>원</span>
                  </div>
                </div>

                {amount > 0 && (
                  <div className="topup-breakdown">
                    <div><span>공급가액(충전될 잔액)</span><b>{charge.toLocaleString()}원</b></div>
                    <div><span>부가세 (10%)</span><span>{vat.toLocaleString()}원</span></div>
                    <div className="total"><span>입금 금액</span><b>{amount.toLocaleString()}원</b></div>
                    {amount < 11000 && <p className="topup-warn">최소 입금 금액은 11,000원(충전 10,000원)입니다.</p>}
                  </div>
                )}

                <label className="topup-terms">
                  <input type="checkbox" name="agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span>
                    <b>환불 약관 동의</b> — 충전된 잔액은 API 호출에 사용됩니다. 미사용 잔액은 관련 법령에 따라
                    환불 요청할 수 있으며, 결제·이체 실비를 제외하고 환불됩니다. 세금계산서는 공급가액 기준으로 발행됩니다.
                    {" "}<a href="/refund" target="_blank" rel="noopener noreferrer" style={{ color: "var(--action)" }}>환불 정책 전문 보기</a>
                  </span>
                </label>

                <div className="topup-actions">
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(false)}>취소</button>
                  <button type="submit" className="btn btn-sm" disabled={!valid}>동의하고 입금 계좌 확인</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
