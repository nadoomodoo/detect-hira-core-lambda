import type { Metadata } from "next";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

export const metadata: Metadata = {
  title: "개인정보 처리방침 · 나두AI 마켓플레이스",
};

export default function Privacy() {
  return (
    <>
      <PublicHeader fluid />
      <main className="legal">
        <h1>개인정보 처리방침</h1>
        <p className="legal-meta">시행일: 2026-07-18 · 주식회사 나두모두</p>

        <p>
          주식회사 나두모두(이하 “회사”)는 「개인정보 보호법」 등 관련 법령을
          준수하며, 나두AI 마켓플레이스 (market.nadoo.ai, 이하 “서비스”)
          이용자의 개인정보를 보호하기 위해 다음과 같이 개인정보 처리방침을
          수립·공개합니다.
        </p>

        <h2>제1조 (개인정보의 처리 목적)</h2>
        <ul>
          <li>회원 가입 및 관리, 본인 확인, 이메일 인증</li>
          <li>API 서비스 제공 및 요금(잔액) 정산·과금</li>
          <li>결제·입금 확인, 세금계산서 발행, 환불 처리</li>
          <li>서비스 이용 문의 대응, 부정 이용 방지, 서비스 개선</li>
        </ul>

        <h2>제2조 (처리하는 개인정보 항목)</h2>
        <ul>
          <li>
            <strong>회원 정보</strong>: 이메일, 이름(선택), 비밀번호(암호화
            저장)
          </li>
          <li>
            <strong>결제·정산 정보</strong>: 충전·입금 내역, 거래 원장,
            (세금계산서 발행 시) 사업자 정보
          </li>
          <li>
            <strong>이용 기록</strong>: API 호출 일시·사용량·요청 식별자, 접속
            IP, 브라우저 정보
          </li>
          <li>
            <strong>업로드 이미지</strong>: 검출 처리를 위해 업로드하는
            처방전·EDI 이미지 — 처리 목적 달성에만 사용됩니다(제3조 참조).
          </li>
        </ul>

        <h2>제3조 (보유·이용 기간 및 파기)</h2>
        <ul>
          <li>
            회원 정보: <strong>회원 탈퇴 시까지</strong>
          </li>
          <li>
            계약·결제·거래 기록: <strong>5년</strong> (전자상거래 등에서의
            소비자보호에 관한 법률)
          </li>
          <li>
            소비자 불만·분쟁 처리 기록: <strong>3년</strong>
          </li>
          <li>
            접속 기록: <strong>1년</strong> (통신비밀보호법)
          </li>
          <li>
            <strong>업로드 원본 이미지는 별도로 저장하지 않으며</strong>, 검출
            결과 이미지는 처리 후 <strong>30일 이내 자동 삭제</strong>됩니다.
          </li>
        </ul>

        <h2>제4조 (개인정보의 제3자 제공)</h2>
        <p>
          회사는 이용자의 개인정보를 제1조의 목적 범위를 넘어 제3자에게 제공하지
          않습니다. 다만 법령에 근거가 있거나 수사기관의 적법한 요청이 있는
          경우는 예외로 합니다.
        </p>

        <h2>제5조 (개인정보 처리의 위탁)</h2>
        <p>
          회사는 안정적인 서비스 제공을 위해 아래와 같이 개인정보 처리를
          위탁하고 있습니다.
        </p>
        <table className="legal-table">
          <thead>
            <tr>
              <th>수탁자</th>
              <th>위탁 업무</th>
              <th>처리 항목</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Google Cloud Platform (Google LLC)</td>
              <td>서버·데이터베이스·스토리지 등 인프라</td>
              <td>수집 항목 전반</td>
            </tr>
            <tr>
              <td>Resend (Resend, Inc.)</td>
              <td>이메일 인증·알림 발송</td>
              <td>이메일</td>
            </tr>
          </tbody>
        </table>
        <p className="legal-meta" style={{ marginTop: 0 }}>
          · 일부 수탁자의 처리 설비가 국외(미국 등)에 위치할 수 있으며, 관련
          법령에 따라 안전하게 처리됩니다.
        </p>

        <h2>제6조 (정보주체의 권리와 행사 방법)</h2>
        <p>
          이용자는 언제든지 개인정보 열람·정정·삭제·처리정지를 요구할 수 있으며,
          대시보드에서 직접 정보를 수정하거나 아래 연락처로 요청할 수 있습니다.
        </p>

        <h2>제7조 (안전성 확보 조치)</h2>
        <ul>
          <li>관리적 조치: 내부관리계획 수립, 접근 권한 최소화</li>
          <li>
            기술적 조치: 비밀번호 단방향 암호화, 전송구간 암호화(HTTPS), 접근
            통제, 시크릿 관리
          </li>
          <li>물리적 조치: 클라우드 데이터센터의 물리적 접근 통제</li>
        </ul>

        <h2>제8조 (개인정보 보호책임자)</h2>
        <ul>
          <li>개인정보 보호책임자: 임희은</li>
          <li>
            연락처:{" "}
            <a href="mailto:privacy@nadoomodoo.com">privacy@nadoomodoo.com</a> ·
            02-557-4423
          </li>
        </ul>

        <h2>제9조 (처리방침의 변경)</h2>
        <p>
          이 개인정보 처리방침은 시행일부터 적용되며, 내용 추가·삭제·수정이 있을
          경우 시행 최소 7일 전부터 서비스 공지사항을 통해 안내합니다.
        </p>

        <p className="legal-meta">공고일: 2026-07-18 · 시행일: 2026-07-18</p>
      </main>
      <PublicFooter />
    </>
  );
}
