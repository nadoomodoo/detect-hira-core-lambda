import Link from "next/link";

export const metadata = { title: "API 문서 — CSO API" };

export default function Docs() {
  return (
    <>
      <nav className="topnav">
        <div className="container">
          <Link href="/" className="brand">CSO API</Link>
          <Link href="/login" className="btn btn-secondary">로그인</Link>
        </div>
      </nav>

      <main className="doc">
        <h1>API 문서</h1>
        <p style={{ marginTop: 12 }}>처방전·EDI 이미지에서 HIRA 약가코드(9자리)를 검출하고 제약사를 태깅하는 REST API입니다.</p>

        <h2>1. 시작하기</h2>
        <ol>
          <li><Link href="/signup">회원가입</Link> 후 로그인합니다.</li>
          <li>대시보드 → <b>API 키</b>에서 <b>새 API 키 발급</b>을 누릅니다. 키(<code>pk_live_…</code>)는 <b>발급 시 한 번만</b> 표시되니 안전하게 보관하세요.</li>
          <li>아래처럼 <code>x-api-key</code> 헤더에 키를 담아 호출합니다.</li>
        </ol>
        <p>무료 제공량(계정당 10회)을 초과하면 <b>402</b>가 반환되며, 대시보드의 <b>사용 신청</b>으로 유료 사용을 신청할 수 있습니다.</p>

        <h2>2. 인증</h2>
        <p>모든 요청에 발급받은 API 키를 헤더로 전달합니다.</p>
        <pre><code>{`x-api-key: pk_live_xxxxxxxxxxxxxxxxxxxxxxxx`}</code></pre>

        <h2>3. 엔드포인트</h2>
        <p><b>POST</b> <code>https://csoapi.nadoo.ai/api/v1/hira-detect/detect</code></p>
        <h3>요청 (택1)</h3>
        <ul>
          <li><b>바이너리 업로드</b>: <code>Content-Type: image/jpeg</code> (또는 png), 본문에 이미지 바이트</li>
          <li><b>JSON</b>: <code>{`{ "image": "<base64>" }`}</code> 또는 <code>{`{ "imageUrl": "https://..." }`}</code></li>
          <li>(선택) <code>Idempotency-Key</code> 헤더 — 재시도 시 이중 과금 방지</li>
        </ul>

        <h3>cURL 예시</h3>
        <pre><code>{`curl -X POST https://csoapi.nadoo.ai/api/v1/hira-detect/detect \\
  -H "x-api-key: pk_live_xxxxxxxx" \\
  -H "Content-Type: image/jpeg" \\
  --data-binary @처방전.jpg`}</code></pre>

        <h2>4. 응답</h2>
        <pre><code>{`{
  "requestId": "b1c2...",
  "items": [
    { "code": "658107190", "manufacturer": "한풍제약 주식회사",
      "drugName": "아제나정(...)", "found": true }
  ],
  "uniqueManufacturers": ["한풍제약 주식회사"],
  "tagged": false,          // 멀티 제약사면 true(라벨 합성 이미지)
  "rotation": 90,           // 자동 회전 보정 각도
  "output": {               // 결과 이미지
    "mode": "gcs",
    "url": "https://storage.googleapis.com/...서명 URL..."
  },
  "cost": { "krw": 200, "free": false },
  "balanceKrw": 49800
}`}</code></pre>
        <p><code>output.mode</code>가 <code>gcs</code>면 <code>url</code>(서명 URL, 기본 1시간)로 결과 이미지를 내려받고, 소형은 <code>{`{ "mode":"inline", "base64":"..." }`}</code>로 바로 반환됩니다.</p>

        <h2>5. 에러</h2>
        <table>
          <thead><tr><th>HTTP</th><th>error</th><th>의미</th></tr></thead>
          <tbody>
            <tr><td>401</td><td><code>invalid_key</code></td><td>API 키 누락/무효</td></tr>
            <tr><td>402</td><td><code>insufficient_credit</code></td><td>무료 소진 + 잔액 부족 (<code>applyUrl</code> 포함)</td></tr>
            <tr><td>404</td><td><code>product_not_found</code></td><td>없는/종료된 프로덕트</td></tr>
            <tr><td>422</td><td><code>bad_image</code></td><td>이미지 해석 불가</td></tr>
            <tr><td>502</td><td><code>processor_error</code></td><td>처리 실패 (해당 호출은 자동 환불)</td></tr>
          </tbody>
        </table>

        <h2>6. 과금</h2>
        <ul>
          <li>성공 호출당 <b>200원</b> (계정당 <b>무료 10회</b> 후 과금)</li>
          <li>실패(502) 호출은 과금되지 않습니다(자동 환불)</li>
          <li>잔액·이력은 대시보드에서 확인</li>
        </ul>

        <p className="muted" style={{ marginTop: 40 }}>출처: 건강보험심사평가원, 공공누리 제1유형</p>
      </main>
    </>
  );
}
