import type { Metadata } from "next";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

export const metadata: Metadata = { title: "환불 정책 · 나두AI 마켓플레이스" };

export default function Refund() {
  return (
    <>
      <PublicHeader fluid />
      <main className="legal">
        <h1>환불 정책</h1>
        <p className="legal-meta">시행일: 2026-07-18 · 주식회사 나두모두</p>

        <p>
          나두AI 마켓플레이스(이하 “서비스”)의 충전 잔액 환불 기준은 아래와 같습니다.
          충전 잔액은 API 호출(건당 과금)에 사용되는 선불 이용 잔액이며, 부가가치세 10%가 포함되어 결제됩니다.
          <strong>API 호출 시 그 즉시 잔액에서 요금이 차감되므로</strong>, 환불은 <strong>차감 후 남은 잔액</strong>을 기준으로 합니다.
        </p>

        <h2>1. 환불 기준</h2>
        <table className="legal-table">
          <thead>
            <tr><th>구분</th><th>100% 환불</th><th>수수료 차감 후 환불</th><th>환불 불가</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>충전 잔액</strong><br />(API 이용)</td>
              <td>결제일로부터 <strong>7일 이내</strong> 요청<br />+ <strong>미사용</strong> 상태(충전액 전액 잔존)</td>
              <td><strong>1건 이상 사용 시</strong><br />남은 잔액에서 <strong>10% 수수료</strong> 차감 후 환불</td>
              <td>남은 잔액이 <strong>1,000원 미만</strong>인 경우</td>
            </tr>
          </tbody>
        </table>
        <p className="legal-meta" style={{ marginTop: 0 }}>
          · 사용한 호출 요금은 호출 시점에 이미 잔액에서 차감되었으므로 환불 계산에서 별도로 다시 차감하지 않습니다. 무료 제공량으로 처리된 호출은 차감되지 않습니다.
        </p>

        <h2>2. 환불 방법</h2>
        <ul>
          <li>환불은 <strong>결제 시 사용한 수단</strong>으로 동일 금액 환불됩니다. 카드 결제 건은 <strong>부분 취소</strong>가 적용되며, 무통장 입금 건은 요청하신 계좌로 이체됩니다.</li>
          <li>환불 요청은 대시보드 문의 또는 <a href="mailto:sales@nadoomodoo.com">sales@nadoomodoo.com</a> 으로 접수하실 수 있습니다.</li>
          <li>세금계산서가 발행된 건은 환불 시 <strong>수정세금계산서</strong>가 함께 발행됩니다.</li>
        </ul>

        <h2>3. 유의사항</h2>
        <div className="legal-note">
          <p>※ 결제(PG)사 정책상 <strong>결제일로부터 1년이 지난 결제 건</strong>은 환불되지 않으며, <strong>환불 금액이 1,000원 이하</strong>인 경우 환불되지 않습니다.</p>
          <p>※ 충전 잔액의 유효기간은 결제일로부터 <strong>1년</strong>입니다(<a href="/terms">이용약관</a> 제5조).</p>
          <p>※ 부정 사용·약관 위반으로 이용이 제한된 경우 환불이 제한될 수 있습니다.</p>
        </div>

        <p className="legal-meta">문의: 주식회사 나두모두 · 02-557-4423 · sales@nadoomodoo.com</p>
      </main>
      <PublicFooter />
    </>
  );
}
