import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { uploadPriceTable } from "./actions";

/**
 * 약가 상한금액표 업로드 (SCD Type 2) — 업로드마다 변경분만 새 이력 버전으로 적재.
 * DrugMaster.unitPrice 는 current 비정규화 사본(추출 검증의 수량×단가=금액 대조에 사용).
 */
export const dynamic = "force-dynamic";
const fmt = (d: Date) => new Date(d).toISOString().slice(0, 10);
const won = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString()}원`);

export default async function DrugPricesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; total?: string; inserted?: string; changed?: string; unchanged?: string; skipped?: string; error?: string; code?: string }>;
}) {
  const sp = await searchParams;
  const code = (sp.code ?? "").trim();

  const [withPrice, totalMaster, currentHist, batches] = await Promise.all([
    prisma.drugMaster.count({ where: { unitPrice: { not: null } } }),
    prisma.drugMaster.count(),
    prisma.drugPriceHistory.count({ where: { current: true } }),
    prisma.drugPriceHistory.groupBy({
      by: ["batch", "validFrom"],
      _count: { _all: true },
      orderBy: { validFrom: "desc" },
      take: 20,
    }),
  ]);

  // 코드 이력 조회(SCD2 타임라인)
  const history = code
    ? await prisma.drugPriceHistory.findMany({ where: { drugCode: code }, orderBy: { validFrom: "desc" } })
    : [];

  const errMsg: Record<string, string> = {
    nofile: "xlsx 파일을 선택해 주세요.",
    nodate: "기준일(YYYY-MM-DD)을 입력해 주세요.",
    empty: "빈 파일입니다.",
    parse: "제품코드/상한금액 컬럼을 인식하지 못했습니다. 약제급여목록표 양식인지 확인하세요.",
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>약가 상한금액표 업로드 (SCD2)</h1>
          <p className="purpose">약제급여목록·상한금액표(xlsx)를 업로드하면 변경분만 이력 버전으로 적재합니다. 단가는 추출 검증(수량×단가=금액)의 마스터 대조에 사용됩니다.</p>
        </div>
      </div>

      {sp.ok && (
        <div className="flashbar flashbar-success">
          적재 완료 — 총 {sp.total} · 신규 {sp.inserted} · 변경 {sp.changed} · 동일 {sp.unchanged} · 스킵 {sp.skipped}
        </div>
      )}
      {sp.error && <div className="flashbar flashbar-error">{errMsg[sp.error] ?? sp.error}</div>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div className="form-section" style={{ flex: 1, minWidth: 200 }}><h3 className="muted">단가 보유</h3><div style={{ fontSize: 24, fontWeight: 700 }}>{withPrice.toLocaleString()}</div><p className="muted">/ 마스터 {totalMaster.toLocaleString()}건</p></div>
        <div className="form-section" style={{ flex: 1, minWidth: 200 }}><h3 className="muted">현재 이력(current)</h3><div style={{ fontSize: 24, fontWeight: 700 }}>{currentHist.toLocaleString()}</div><p className="muted">DrugPriceHistory</p></div>
      </div>

      <form className="form-section stack" action={uploadPriceTable} style={{ marginBottom: 24 }}>
        <h3 style={{ fontWeight: 700 }}>상한금액표 업로드</h3>
        <p className="muted">제품코드(9자리) · 상한금액표 금액 · 제품명 · 업체명 컬럼을 자동 인식합니다.</p>
        <div className="field"><label>xlsx 파일</label><input type="file" name="file" accept=".xlsx" required /></div>
        <div className="field"><label>기준일 (상한금액표 적용일)</label><input type="date" name="effectiveFrom" required /></div>
        <button className="btn btn-sm" type="submit">업로드 · SCD2 적재</button>
      </form>

      {/* 코드별 이력 타임라인 */}
      <form method="get" className="form-section stack" style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 700 }}>코드별 단가 이력 조회</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input name="code" defaultValue={code} placeholder="약가코드 9자리" pattern="\d{9}" style={{ flex: 1 }} />
          <button className="btn btn-sm btn-secondary" type="submit">조회</button>
        </div>
      </form>

      {code && (
        <div className="collection" style={{ marginBottom: 24 }}>
          <div className="collection-toolbar"><span className="count"><b>{code}</b> — 이력 {history.length}건</span></div>
          {history.length === 0 ? (
            <div className="empty-state"><h3>이력 없음</h3></div>
          ) : (
            <table className="tbl">
              <thead><tr><th>상한금액</th><th>유효 시작</th><th>유효 종료</th><th>상태</th><th>배치</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{won(h.unitPrice)}</td>
                    <td className="muted">{fmt(h.validFrom)}</td>
                    <td className="muted">{h.validTo ? fmt(h.validTo) : "—"}</td>
                    <td>{h.current ? <StatusBadge kind="success" label="현재" /> : <StatusBadge kind="neutral" label="종료" />}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{h.batch ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="collection">
        <div className="collection-toolbar"><span className="count">업로드 배치 (기준일별)</span></div>
        {batches.length === 0 ? (
          <div className="empty-state"><h3>업로드 이력 없음</h3></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>기준일</th><th>배치</th><th>이력 행</th></tr></thead>
            <tbody>
              {batches.map((b, i) => (
                <tr key={i}>
                  <td>{fmt(b.validFrom)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{b.batch ?? "—"}</td>
                  <td>{b._count._all.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
