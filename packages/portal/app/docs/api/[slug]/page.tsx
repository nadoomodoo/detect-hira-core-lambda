import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@platform/db";
import { API_BASE } from "@/lib/config";
import { DemoWidget } from "@/components/demo/DemoWidget";

export const dynamic = "force-dynamic";
const UNIT: Record<string, string> = { CALL: "호출", IMAGE: "이미지", PAGE: "페이지" };

export default async function ApiReference({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let product: Awaited<ReturnType<typeof prisma.product.findUnique>> = null;
  try {
    product = await prisma.product.findUnique({ where: { slug } });
  } catch (e) { console.error("DOCS_API_DB_ERR", e); }
  if (!product) notFound();

  const url = `${API_BASE}/api/v1/${product.slug}/detect`;

  return (
    <main className="doc">
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
        <span className="status status-success">POST</span>
        <span className="muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 14 }}>/api/v1/{product.slug}/detect</span>
      </div>
      <h1>{product.name}</h1>
      <p style={{ marginTop: 10 }}>{product.description ?? "제약 CSO 업무용 API"}</p>
      <div style={{ display: "flex", gap: 18, marginTop: 14, flexWrap: "wrap" }}>
        <span className="badge">무료 {product.freeQuota}회</span>
        <b style={{ fontVariantNumeric: "tabular-nums" }}>{product.priceKrw.toLocaleString()}원 / {UNIT[product.billingUnit] ?? "호출"}</b>
        <Link href={`/docs/api/${product.slug}/openapi.json`}>OpenAPI 스펙(JSON)</Link>
      </div>

      <h2>데모 체험</h2>
      <p style={{ marginBottom: 12 }}>이미지를 올려 실제 결과를 바로 확인하세요. (로그인 없이, 하루 횟수 제한)</p>
      <DemoWidget />

      <h2>엔드포인트</h2>
      <pre><code>{`POST ${url}`}</code></pre>

      <h2>인증</h2>
      <table>
        <thead><tr><th>헤더</th><th>타입</th><th>필수</th><th>설명</th></tr></thead>
        <tbody>
          <tr><td><code>x-api-key</code></td><td>string</td><td>필수</td><td>대시보드에서 발급한 API 키 (<code>pk_live_…</code>)</td></tr>
        </tbody>
      </table>

      <h2>요청</h2>
      <h3>요청 헤더</h3>
      <table>
        <thead><tr><th>헤더</th><th>타입</th><th>필수</th><th>설명</th></tr></thead>
        <tbody>
          <tr><td><code>Content-Type</code></td><td>string</td><td>필수</td><td><code>image/jpeg</code>, <code>image/png</code> (바이너리) 또는 <code>application/json</code></td></tr>
          <tr><td><code>Idempotency-Key</code></td><td>string</td><td>선택</td><td>동일 키 재요청 시 이중 과금 방지 (권장: UUID)</td></tr>
        </tbody>
      </table>

      <h3>요청 본문 — (A) 바이너리</h3>
      <p><code>Content-Type: image/jpeg</code>(또는 png)로 이미지 바이트를 그대로 전송합니다. (최대 25MB)</p>

      <h3>요청 본문 — (B) JSON</h3>
      <table>
        <thead><tr><th>필드</th><th>타입</th><th>필수</th><th>설명</th></tr></thead>
        <tbody>
          <tr><td><code>image</code></td><td>string</td><td>택1</td><td>base64 인코딩된 이미지</td></tr>
          <tr><td><code>imageUrl</code></td><td>string(uri)</td><td>택1</td><td>이미지 https URL (서버가 다운로드). <code>image</code>와 택일</td></tr>
        </tbody>
      </table>

      <h2>응답 <span className="status status-success" style={{ marginLeft: 6 }}>200 OK</span></h2>
      <table>
        <thead><tr><th>필드</th><th>타입</th><th>설명</th></tr></thead>
        <tbody>
          <tr><td><code>requestId</code></td><td>string</td><td>요청 식별자 (idempotency 키와 동일)</td></tr>
          <tr><td><code>items</code></td><td>object[]</td><td>검출된 약가코드별 결과 (아래 items 스키마)</td></tr>
          <tr><td><code>items[].code</code></td><td>string</td><td>9자리 약가코드</td></tr>
          <tr><td><code>items[].manufacturer</code></td><td>string | null</td><td>제약사명 (코마케팅 표기 반영, 미조회 시 null)</td></tr>
          <tr><td><code>items[].drugName</code></td><td>string | null</td><td>의약품명 (미조회 시 null)</td></tr>
          <tr><td><code>items[].found</code></td><td>boolean</td><td>마스터 조회 성공 여부</td></tr>
          <tr><td><code>uniqueManufacturers</code></td><td>string[]</td><td>검출된 제약사 목록 (중복 제거)</td></tr>
          <tr><td><code>tagged</code></td><td>boolean</td><td>멀티 제약사면 <code>true</code> → 라벨 합성 이미지 반환</td></tr>
          <tr><td><code>rotation</code></td><td>number</td><td>자동 보정한 회전 각도 (0/90/180/270)</td></tr>
          <tr><td><code>unknownCodes</code></td><td>string[]</td><td>검출됐으나 마스터 미조회된 코드</td></tr>
          <tr><td><code>output</code></td><td>object</td><td>결과 이미지 (아래 output 스키마)</td></tr>
          <tr><td><code>output.mode</code></td><td>"gcs" | "inline"</td><td><code>gcs</code>=서명 URL, <code>inline</code>=base64 직접</td></tr>
          <tr><td><code>output.url</code></td><td>string(uri)</td><td>(gcs) 결과 이미지 서명 URL, 기본 1시간 유효</td></tr>
          <tr><td><code>output.base64</code></td><td>string</td><td>(inline) base64 인코딩 결과 이미지</td></tr>
          <tr><td><code>output.contentType</code></td><td>string</td><td>결과 이미지 MIME (image/png 또는 image/jpeg)</td></tr>
          <tr><td><code>cost.krw</code></td><td>number</td><td>이번 호출 과금액(원). 무료 처리 시 0</td></tr>
          <tr><td><code>cost.free</code></td><td>boolean</td><td>무료 제공량으로 처리됐는지</td></tr>
          <tr><td><code>balanceKrw</code></td><td>number</td><td>처리 후 크레딧 잔액(원)</td></tr>
        </tbody>
      </table>
      <h3>응답 예시</h3>
      <pre><code>{`{
  "requestId": "3f9a1c2e-...",
  "items": [
    { "code": "658107190", "manufacturer": "한풍제약 주식회사",
      "drugName": "아제나정(아젤라스틴염산염)", "found": true }
  ],
  "uniqueManufacturers": ["한풍제약 주식회사"],
  "tagged": false,
  "rotation": 90,
  "unknownCodes": [],
  "output": {
    "mode": "gcs",
    "contentType": "image/jpeg",
    "url": "https://storage.googleapis.com/cso-ai-results/annotated/...?X-Amz-..."
  },
  "cost": { "krw": ${product.priceKrw}, "free": false },
  "balanceKrw": 49800
}`}</code></pre>

      <h2>에러 응답</h2>
      <p>본문: <code>{`{ "error": "<code>", ... }`}</code></p>
      <table>
        <thead><tr><th>HTTP</th><th>error</th><th>추가 필드</th><th>의미</th></tr></thead>
        <tbody>
          <tr><td>401</td><td><code>invalid_key</code></td><td>—</td><td>API 키 누락/무효</td></tr>
          <tr><td>402</td><td><code>insufficient_credit</code></td><td><code>freeUsed</code>, <code>freeQuota</code>, <code>applyUrl</code></td><td>무료 소진 + 잔액 부족</td></tr>
          <tr><td>404</td><td><code>product_not_found</code></td><td>—</td><td>없는/종료된 API</td></tr>
          <tr><td>422</td><td><code>bad_image</code></td><td>—</td><td>이미지/본문 해석 불가</td></tr>
          <tr><td>502</td><td><code>processor_error</code></td><td><code>refunded</code></td><td>처리 실패 (자동 환불)</td></tr>
        </tbody>
      </table>
      <pre><code>{`// 402 예시
{ "error": "insufficient_credit", "freeUsed": 10, "freeQuota": 10,
  "applyUrl": "https://market.nadoo.ai/dashboard/apply" }`}</code></pre>

      <h2>예시 (cURL)</h2>
      <pre><code>{`curl -X POST ${url} \\
  -H "x-api-key: pk_live_xxxxxxxx" \\
  -H "Content-Type: image/jpeg" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  --data-binary @처방전.jpg`}</code></pre>

      <p style={{ marginTop: 32 }}><Link href="/login" className="btn">시작하기 (키 발급)</Link></p>
    </main>
  );
}
