import Link from "next/link";

/**
 * hira-extract(EDI 숫자컬럼 추출) 전용 API 문서.
 * detect(라벨링)와 완전히 분리 — items[]는 약품 라인아이템(코드·약품명·숫자), box/labeled 없음.
 */
export function ExtractDocs({ product, apiBase }: { product: { slug: string; priceKrw: number }; apiBase: string }) {
  const url = `${apiBase}/api/v1/${product.slug}/extract`;
  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "24px 0 4px" }}>
        <span className="status status-success">POST</span>
        <span className="muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 14 }}>/api/v1/{product.slug}/extract</span>
      </div>
      <p style={{ marginBottom: 12 }}>이미지를 자동으로 정렬·보정한 뒤 표를 읽어, <b>약품별 수량·일수·총처방량·단가·총금액</b>을 추출합니다. 값은 <b>이미지에서 읽어낸 원본</b>이며, 계산·기준가 대조는 검증에만 씁니다. 약가코드가 비표준(대학병원 자체코드 등)이어도 <b>약품명은 제공</b>되고 라인별 <code>needsReview</code>로 확인 여부를 표시합니다.</p>

      <h2>엔드포인트</h2>
      <pre><code>{`POST ${url}`}</code></pre>

      <h2>인증</h2>
      <table>
        <thead><tr><th>헤더</th><th>타입</th><th>필수</th><th>설명</th></tr></thead>
        <tbody>
          <tr><td><code>x-api-key</code></td><td>string</td><td>필수</td><td>대시보드 발급 API 키 (<code>pk_live_…</code>)</td></tr>
          <tr><td><code>Content-Type</code></td><td>string</td><td>필수</td><td><code>application/json</code></td></tr>
          <tr><td><code>Idempotency-Key</code></td><td>string</td><td>선택</td><td>재시도 이중 과금 방지 (권장: UUID). 재시도 시 <b>같은 키 + 같은 본문</b>이면 재처리 없이 최초 결과를 반환하고, 같은 키로 <b>다른 본문</b>을 보내면 <code>422</code>. 키를 안 보내면 매 요청이 별건 처리됨.</td></tr>
        </tbody>
      </table>

      <h2>요청 본문 (JSON)</h2>
      <table>
        <thead><tr><th>필드</th><th>타입</th><th>필수</th><th>설명</th></tr></thead>
        <tbody>
          <tr><td><code>image</code></td><td>string</td><td>택1</td><td>base64 인코딩 이미지</td></tr>
          <tr><td><code>imageUrl</code></td><td>string(uri)</td><td>택1</td><td>이미지 https URL (서버 다운로드)</td></tr>
          <tr><td><code>templateId</code></td><td>string</td><td>선택</td><td>특정 프롬프트 템플릿 버전으로 추출 (미지정 시 활성 최신본)</td></tr>
        </tbody>
      </table>

      <h2>응답 <span className="status status-success" style={{ marginLeft: 6 }}>200 OK</span></h2>
      <table>
        <thead><tr><th>필드</th><th>타입</th><th>설명</th></tr></thead>
        <tbody>
          <tr><td><code>requestId</code></td><td>string</td><td>요청 식별자</td></tr>
          <tr><td><code>documentType</code></td><td>string</td><td><code>drug_table</code>=약품표. 아니면 <code>business_registration</code>/<code>receipt</code>/<code>other</code> 등 표 없음 사유</td></tr>
          <tr><td><code>foundTable</code></td><td>boolean</td><td>약품 표 검출 여부</td></tr>
          <tr><td><code>items</code></td><td>object[]</td><td>약품 라인아이템 (아래 스키마)</td></tr>
          <tr><td><code>items[].drugCode</code></td><td>string | null</td><td>약가코드 — 보이는 그대로(9자리 아닐 수 있음)</td></tr>
          <tr><td><code>items[].drugName</code></td><td>string | null</td><td>약품명 (코드 비표준이어도 제공)</td></tr>
          <tr><td><code>items[].quantity</code></td><td>number | null</td><td>수량(처방횟수·환자수 포함)</td></tr>
          <tr><td><code>items[].days</code></td><td>number | null</td><td>일수(투약일수)</td></tr>
          <tr><td><code>items[].prescribedQty</code></td><td>number | null</td><td>총처방량(총사용량/총투여량)</td></tr>
          <tr><td><code>items[].unitPrice</code></td><td>number | null</td><td>단가</td></tr>
          <tr><td><code>items[].totalAmount</code></td><td>number | null</td><td>총금액</td></tr>
          <tr><td><code>items[].codeInMaster</code></td><td>boolean</td><td>약가 마스터 조회 성공 여부</td></tr>
          <tr><td><code>items[].priceCheck</code></td><td>string</td><td>단가 검증 — <code>current</code>(현재가 일치)/<code>historical</code>(과거가·단가변동)/<code>mismatch</code>/<code>none</code></td></tr>
          <tr><td><code>items[].status</code></td><td>string</td><td><code>GREEN</code>(정상)/<code>YELLOW</code>(확인 권장)/<code>RED</code>(오류·확인 필요)</td></tr>
          <tr><td><code>items[].needsReview</code></td><td>boolean</td><td>사람 확인 필요 여부</td></tr>
          <tr><td><code>items[].review</code></td><td>string[]</td><td>확인 사유</td></tr>
          <tr><td><code>summary</code></td><td>object</td><td><code>items</code>(행수)·<code>needsReview</code>(확인필요 수)·<code>byStatus</code>(green/yellow/red)·<code>completeExtraction</code>(합계 대조 전체추출 여부)</td></tr>
          <tr><td><code>meta</code></td><td>object</td><td>진단(참고) — <code>imageReadable</code>·<code>imageIssues[]</code>·<code>rotationApplied</code>·<code>cropped</code>·<code>droppedSummaryRows</code>·<code>template</code>. 외부 처리에 불필요하면 무시 가능</td></tr>
          <tr><td><code>cost.krw</code> / <code>cost.free</code></td><td>number / boolean</td><td>과금액 / 무료 처리 여부</td></tr>
          <tr><td><code>balanceKrw</code></td><td>number</td><td>처리 후 잔액</td></tr>
        </tbody>
      </table>
      <h3>응답 예시</h3>
      <pre><code>{`{
  "requestId": "3f9a1c2e-...",
  "documentType": "drug_table",
  "foundTable": true,
  "items": [
    { "drugCode": "658106350", "drugName": "OO정",
      "quantity": 83, "days": null, "prescribedQty": 2355,
      "unitPrice": 312, "totalAmount": 734760,
      "codeInMaster": true, "priceCheck": "current",
      "status": "GREEN", "needsReview": false, "review": [] }
  ],
  "summary": { "items": 4, "needsReview": 0,
    "byStatus": { "green": 4, "yellow": 0, "red": 0 },
    "completeExtraction": true },
  "meta": { "imageReadable": true, "imageIssues": [],
    "rotationApplied": 0, "cropped": true, "droppedSummaryRows": 1,
    "template": { "key": "edi-extract", "version": 3 } },
  "cost": { "krw": ${product.priceKrw}, "free": false },
  "balanceKrw": 49700
}`}</code></pre>

      <h2>예시 (cURL)</h2>
      <pre><code>{`curl -X POST ${url} \\
  -H "x-api-key: pk_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"imageUrl":"https://.../edi.jpg"}'`}</code></pre>

      <h2>대용량 업로드 (presigned, 권장)</h2>
      <p>base64는 요청 크기 한계(~18MB 이미지)가 있어, <b>대용량·대량은 presigned 업로드</b>가 안정적입니다(용량 무제한). ① 업로드 URL 발급 → ② 이미지 PUT → ③ <code>imageUrl</code>로 추출.</p>
      <pre><code>{`# 1) 업로드 URL 발급
curl -X POST ${apiBase}/api/v1/uploads \\
  -H "x-api-key: pk_live_xxxxxxxx" -H "Content-Type: application/json" \\
  -d '{"contentType":"image/jpeg"}'
# → { "uploadUrl": "https://storage.googleapis.com/...(PUT)", "imageUrl": "https://...(read)", "expiresIn": 3600 }

# 2) 이미지 업로드(PUT) — Content-Type 일치
curl -X PUT "<uploadUrl>" -H "Content-Type: image/jpeg" --data-binary @edi.jpg

# 3) 추출 — imageUrl 로 전달(base64 불필요)
curl -X POST ${url} -H "x-api-key: pk_live_xxxxxxxx" -H "Content-Type: application/json" \\
  -d '{"imageUrl":"<imageUrl>"}'`}</code></pre>

      <h2>대량 비동기 (수천 장)</h2>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
        <span className="status status-success">POST</span>
        <span className="muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 14 }}>/api/v1/{product.slug}/extract-batch-async</span>
      </div>
      <p>이미지 배열을 접수하고 <code>{`{ jobId }`}</code>를 즉시 반환합니다(백그라운드 처리). <code>GET /api/v1/jobs/&#123;jobId&#125;</code>로 진행률·신호등 집계·항목별 상태를 폴링합니다. 대량은 <code>imageUrls</code> 권장.</p>
      <pre><code>{`curl -X POST ${apiBase}/api/v1/${product.slug}/extract-batch-async \\
  -H "x-api-key: pk_live_xxxxxxxx" -H "Content-Type: application/json" \\
  -d '{"imageUrls":["https://.../a.jpg","https://.../b.jpg"], "templateId":"..."}'
# → { "jobId": "...", "status": "queued", "pollUrl": "/api/v1/jobs/..." }`}</code></pre>

      <h2>에러 응답</h2>
      <table>
        <thead><tr><th>HTTP</th><th>error</th><th>의미</th></tr></thead>
        <tbody>
          <tr><td>401</td><td><code>invalid_key</code></td><td>API 키 누락/무효</td></tr>
          <tr><td>402</td><td><code>insufficient_credit</code></td><td>무료 소진 + 잔액 부족</td></tr>
          <tr><td>400</td><td><code>no_image</code> / <code>bad_json</code></td><td>이미지 또는 JSON 본문 오류</td></tr>
          <tr><td>502</td><td><code>processor_error</code></td><td>처리 실패(과금분 자동 환불)</td></tr>
        </tbody>
      </table>

      <p style={{ marginTop: 32 }}><Link href="/login" className="btn">시작하기 (키 발급)</Link></p>
    </>
  );
}
