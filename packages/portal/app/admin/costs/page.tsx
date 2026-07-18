import { prisma } from "@platform/db";

/**
 * 원가·마진 — UsageCost(우리 원가) 집계 + CreditTx(매출) 대비 마진.
 * 기간(일수) / 모델별 / 단계별 원가와 벤치마크 실행분을 한눈에.
 */
export const dynamic = "force-dynamic";
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days } = await searchParams;
  const windowDays = Math.max(1, Math.min(365, Number(days ?? 30) || 30));
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);

  // 원가: 실서비스분(benchRun=null)만 마진 계산에 사용
  const costs = await prisma.usageCost.findMany({
    where: { createdAt: { gte: since } },
    select: { stage: true, model: true, calls: true, tokensIn: true, tokensOut: true, costKrw: true, costUsd: true, benchRun: true, productId: true },
  });
  const live = costs.filter((c) => !c.benchRun);

  const sum = (arr: typeof costs, f: (c: (typeof costs)[number]) => number) => arr.reduce((s, c) => s + (f(c) || 0), 0);

  // 모델별 집계
  const byModel = new Map<string, { calls: number; tokensIn: number; tokensOut: number; costKrw: number }>();
  for (const c of live) {
    const m = byModel.get(c.model) ?? { calls: 0, tokensIn: 0, tokensOut: 0, costKrw: 0 };
    m.calls += c.calls; m.tokensIn += c.tokensIn; m.tokensOut += c.tokensOut; m.costKrw += c.costKrw ?? 0;
    byModel.set(c.model, m);
  }
  // 단계별 집계
  const byStage = new Map<string, number>();
  for (const c of live) byStage.set(c.stage, (byStage.get(c.stage) ?? 0) + (c.costKrw ?? 0));

  // 매출: CHARGE 트랜잭션 합(양수 매출 = -deltaKrw 는 과금이 음수이므로 절대값 합산 관례 확인)
  const charges = await prisma.creditTx.aggregate({
    where: { type: "CHARGE", createdAt: { gte: since } },
    _sum: { deltaKrw: true },
    _count: true,
  });
  const revenue = Math.abs(charges._sum.deltaKrw ?? 0);
  const totalCost = sum(live, (c) => c.costKrw ?? 0);
  const margin = revenue - totalCost;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;

  // 벤치마크 실행분
  const benchRuns = new Map<string, number>();
  for (const c of costs.filter((c) => c.benchRun)) benchRuns.set(c.benchRun!, (benchRuns.get(c.benchRun!) ?? 0) + (c.costKrw ?? 0));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>원가·마진</h1>
          <p className="purpose">UsageCost(Gemini 원가) 대비 매출(과금)로 마진을 관리합니다. 최근 {windowDays}일.</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[7, 30, 90].map((d) => (
          <a key={d} className={`btn btn-sm ${d === windowDays ? "" : "btn-secondary"}`} href={`/admin/costs?days=${d}`}>{d}일</a>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div className="form-section" style={{ flex: 1, minWidth: 180 }}><h3 className="muted">매출(과금)</h3><div style={{ fontSize: 24, fontWeight: 700 }}>{won(revenue)}</div><p className="muted">{charges._count}건</p></div>
        <div className="form-section" style={{ flex: 1, minWidth: 180 }}><h3 className="muted">원가(Gemini)</h3><div style={{ fontSize: 24, fontWeight: 700 }}>{won(totalCost)}</div><p className="muted">${sum(live, (c) => c.costUsd ?? 0).toFixed(2)}</p></div>
        <div className="form-section" style={{ flex: 1, minWidth: 180 }}><h3 className="muted">마진</h3><div style={{ fontSize: 24, fontWeight: 700, color: margin >= 0 ? "#15803d" : "#b91c1c" }}>{won(margin)}</div><p className="muted">{marginPct.toFixed(1)}%</p></div>
      </div>

      <div className="collection" style={{ marginBottom: 24 }}>
        <div className="collection-toolbar"><span className="count">모델별 원가</span></div>
        <table className="tbl">
          <thead><tr><th>모델</th><th>호출</th><th>입력 토큰</th><th>출력 토큰</th><th>원가</th></tr></thead>
          <tbody>
            {[...byModel.entries()].sort((a, b) => b[1].costKrw - a[1].costKrw).map(([m, v]) => (
              <tr key={m}><td className="mono">{m}</td><td>{v.calls.toLocaleString()}</td><td>{v.tokensIn.toLocaleString()}</td><td>{v.tokensOut.toLocaleString()}</td><td>{won(v.costKrw)}</td></tr>
            ))}
            {byModel.size === 0 && <tr><td colSpan={5} className="muted">데이터 없음</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="collection" style={{ flex: 1, minWidth: 280 }}>
          <div className="collection-toolbar"><span className="count">단계별 원가</span></div>
          <table className="tbl">
            <thead><tr><th>단계</th><th>원가</th></tr></thead>
            <tbody>
              {[...byStage.entries()].sort((a, b) => b[1] - a[1]).map(([s, v]) => (<tr key={s}><td>{s}</td><td>{won(v)}</td></tr>))}
              {byStage.size === 0 && <tr><td colSpan={2} className="muted">데이터 없음</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="collection" style={{ flex: 1, minWidth: 280 }}>
          <div className="collection-toolbar"><span className="count">벤치마크 실행 원가</span></div>
          <table className="tbl">
            <thead><tr><th>run</th><th>원가</th></tr></thead>
            <tbody>
              {[...benchRuns.entries()].sort((a, b) => b[1] - a[1]).map(([r, v]) => (<tr key={r}><td className="mono">{r}</td><td>{won(v)}</td></tr>))}
              {benchRuns.size === 0 && <tr><td colSpan={2} className="muted">벤치 실행 없음</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
