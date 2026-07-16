import Link from "next/link";

export const metadata = { title: "API 문서 — 나두AI API 마켓플레이스" };

export default function Docs() {
  return (
    <main className="doc">
      <h1>개요</h1>
      <p style={{ marginTop: 12 }}>
        분야별 REST API를 제공하는 나두AI API 마켓플레이스입니다(제약 CSO 등 카테고리별 제공). 계정당 API 키를 발급받아 각 API를 호출합니다.
        API별 상세 스펙은 좌측 <b>API 레퍼런스</b>에서 확인하세요.
      </p>

      <h2>시작하기</h2>
      <ol>
        <li><Link href="/signup">회원가입</Link> 후 로그인합니다.</li>
        <li>대시보드 → <b>API 키</b>에서 키(<code>pk_live_…</code>)를 발급합니다. <b>발급 시 한 번만</b> 표시되니 안전하게 보관하세요.</li>
        <li>좌측 API 레퍼런스에서 원하는 API의 엔드포인트·요청·응답을 확인하고 호출합니다.</li>
      </ol>

      <h2 id="auth">인증</h2>
      <p>모든 요청에 API 키를 헤더로 전달합니다. 키가 없거나 무효면 <code>401</code>이 반환됩니다.</p>
      <pre><code>{`x-api-key: pk_live_xxxxxxxxxxxxxxxxxxxxxxxx`}</code></pre>

      <h2 id="pricing">과금</h2>
      <ul>
        <li>성공 호출당 API별 단가가 과금됩니다(계정×API별 <b>무료 제공량</b> 소진 후).</li>
        <li>실패(5xx) 호출은 과금되지 않습니다(자동 환불).</li>
        <li>무료 제공량을 초과하고 잔액이 부족하면 <code>402</code>가 반환되며, 대시보드의 <b>사용 신청</b>으로 유료 사용을 신청할 수 있습니다.</li>
        <li>가격은 변경될 수 있으며, 각 호출은 <b>호출 시점 단가</b>로 과금·기록됩니다.</li>
      </ul>

      <h2 id="errors">공통 에러</h2>
      <p>에러 응답 본문: <code>{`{ "error": "<code>", "message"?: "..." }`}</code></p>
      <table>
        <thead><tr><th>HTTP</th><th>error</th><th>의미</th></tr></thead>
        <tbody>
          <tr><td><code>401</code></td><td><code>invalid_key</code></td><td>API 키 누락 또는 무효/폐기</td></tr>
          <tr><td><code>403</code></td><td><code>not_entitled</code></td><td>해당 API 사용 권한 없음</td></tr>
          <tr><td><code>402</code></td><td><code>insufficient_credit</code></td><td>무료 소진 + 잔액 부족 (<code>applyUrl</code> 포함)</td></tr>
          <tr><td><code>404</code></td><td><code>product_not_found</code></td><td>존재하지 않거나 종료된 API</td></tr>
          <tr><td><code>422</code></td><td><code>bad_image</code></td><td>요청 본문/이미지 해석 불가</td></tr>
          <tr><td><code>429</code></td><td><code>rate_limited</code></td><td>요청 한도 초과</td></tr>
          <tr><td><code>502</code></td><td><code>processor_error</code></td><td>처리 백엔드 오류 (해당 호출 자동 환불)</td></tr>
        </tbody>
      </table>
    </main>
  );
}
