import { Download, ImageOff } from "lucide-react";
import { prisma } from "@platform/db";
import { Pager } from "@/components/console/Pager";
import { fmtKST } from "@/lib/datetime";

/**
 * 크롭 실패 데이터셋 — 표 영역 자동 크롭이 실패(fallback)해 원본으로 처리된 건을 모아 본다.
 * 추출 시점에 원본을 GCS_RESULT_BUCKET 의 failed-crops/ 로 자동 수집(datasetKey)하며,
 * 이 목록은 그 수집분을 검토·다운로드하기 위한 화면이다(모델 재학습용 데이터셋).
 */
export const dynamic = "force-dynamic";
const PAGE_SIZE = 60;

const docTypeLabel: Record<string, string> = {
  drug_table: "약품 표",
  business_registration: "사업자등록증",
  prescription: "처방전",
  receipt: "영수증",
  other: "기타",
  unknown: "—",
};

const bucket = process.env.GCS_RESULT_BUCKET ?? null;

export default async function CropFailuresPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const where = { datasetKey: { not: null } };

  const total = await prisma.ediExtraction.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);

  const list = await prisma.ediExtraction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (current - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      requestId: true,
      createdAt: true,
      documentType: true,
      cropMeta: true,
      datasetKey: true,
      datasetUrl: true,
      _count: { select: { rows: true } },
    },
  });

  // 실패 사유(cropMeta.skipped)별 집계 — 크롭 서비스 상태 모니터링용.
  const reasons = await prisma.$queryRaw<{ reason: string | null; n: number }[]>`
    SELECT "cropMeta"->>'skipped' AS reason, COUNT(*)::int AS n
    FROM "EdiExtraction"
    WHERE "datasetKey" IS NOT NULL
    GROUP BY reason
    ORDER BY n DESC
  `;

  const qs = (p: number) => `?page=${p}`;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>크롭 실패 데이터셋</h1>
          <p className="purpose">
            표 영역 자동 크롭이 실패해 원본으로 처리된 건입니다. 추출 시 원본을 데이터셋 폴더
            {bucket ? <> (<span className="mono">gs://{bucket}/failed-crops/</span>)</> : " (failed-crops/)"}로 자동 수집합니다 — 크롭 모델 재학습용.
          </p>
        </div>
      </div>

      {reasons.length > 0 && (
        <div className="form-section" style={{ marginBottom: 16 }}>
          <p style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <b>사유별</b>
            {reasons.map((r) => (
              <span key={r.reason ?? "unknown"} className="badge" style={{ background: "#f1f5f9", color: "#334155" }}>
                {r.reason ?? "사유 미상"} · {r.n.toLocaleString()}
              </span>
            ))}
          </p>
        </div>
      )}

      <div className="collection">
        <div className="collection-toolbar">
          <span className="count">총 <b>{total.toLocaleString()}</b>건 · {current}/{pageCount} 페이지</span>
        </div>
        {list.length === 0 ? (
          <div className="empty-state"><h3>수집된 크롭 실패 이미지가 없습니다</h3><p className="muted">크롭 실패가 발생하면 원본이 자동으로 여기에 모입니다.</p></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>미리보기</th><th>생성</th><th>requestId</th><th>문서유형</th><th>행</th><th>실패 사유</th><th>객체 키</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((ex) => {
                const skipped = (ex.cropMeta as { skipped?: string } | null)?.skipped ?? "사유 미상";
                return (
                  <tr key={ex.id}>
                    <td>
                      {ex.datasetUrl ? (
                        <a href={ex.datasetUrl} target="_blank" rel="noreferrer" title="원본 크게 보기 (서명 URL은 시간이 지나면 만료됩니다)">
                          <img src={ex.datasetUrl} alt="크롭 실패 원본" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid #e2e8f0" }} />
                        </a>
                      ) : (
                        <span className="muted" title="미리보기 URL 없음/만료 — 객체 키로 접근하세요" style={{ display: "inline-flex", width: 64, height: 64, alignItems: "center", justifyContent: "center", border: "1px dashed #cbd5e1", borderRadius: 6 }}>
                          <ImageOff size={18} aria-hidden />
                        </span>
                      )}
                    </td>
                    <td className="muted">{fmtKST(ex.createdAt)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{ex.requestId.slice(0, 18)}…</td>
                    <td className={ex.documentType === "drug_table" ? "" : "muted"} style={{ fontSize: 12 }}>{docTypeLabel[ex.documentType ?? "unknown"] ?? ex.documentType}</td>
                    <td>{ex._count.rows}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{skipped}</td>
                    <td className="mono" style={{ fontSize: 11, wordBreak: "break-all", maxWidth: 260 }}>{ex.datasetKey}</td>
                    <td style={{ textAlign: "right" }}>
                      {ex.datasetUrl && (
                        <a className="btn btn-sm btn-secondary" href={ex.datasetUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Download size={13} aria-hidden /> 원본
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pager current={current} pageCount={pageCount} makeHref={qs} />
      </div>
    </>
  );
}
