import { AlertTriangle } from "lucide-react";
import { prisma } from "@platform/db";
import { requireSuperAdmin } from "@/lib/perms";

/**
 * API별 원가 분석 모니터링 — 일자별 원가(UsageCost) vs 매출(CreditTx CHARGE) 시계열(주식처럼).
 * 마진·마진율·원가 급증(초과) 추이를 인라인 SVG 라인차트로 표시. 외부 라이브러리 없음(CSP 안전).
 */
export const dynamic = "force-dynamic";
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

interface DayRow { d: string; productId: string | null; cost: number; tokens: number; calls: number }
interface RevRow { d: string; productId: string | null; rev: number; n: number }

/** 간단 시계열 라인차트(SVG) — 원가(빨강)·매출(초록). */
function Chart({ days, cost, rev }: { days: string[]; cost: number[]; rev: number[] }) {
  const W = 680, H = 140, pad = 8;
  const max = Math.max(1, ...cost, ...rev);
  const n = days.length;
  const x = (i: number) => (n <= 1 ? pad : pad + (i * (W - 2 * pad)) / (n - 1));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const path = (arr: number[]) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 140, background: "#fafafa", border: "1px solid #eee", borderRadius: 8 }}>
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#ddd" />
      <polyline fill="none" stroke="#15803d" strokeWidth="2" points={rev.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
      <polyline fill="none" stroke="#dc2626" strokeWidth="2" points={cost.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
      <text x={pad} y={12} fontSize="10" fill="#15803d">매출</text>
      <text x={pad + 34} y={12} fontSize="10" fill="#dc2626">원가</text>
      <text x={W - pad - 60} y={12} fontSize="10" fill="#64748b">최대 {won(max)}</text>
    </svg>
  );
}

export default async function CostAnalysisPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireSuperAdmin(); // 슈퍼어드민 전용
  const { days } = await searchParams;
  const windowDays = Math.max(7, Math.min(180, Number(days ?? 30) || 30));
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);

  const [costRows, revRows, products] = await Promise.all([
    prisma.$queryRaw<DayRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') d, "productId",
             COALESCE(sum("costKrw"),0)::float cost, COALESCE(sum("tokensIn"+"tokensOut"),0)::int tokens, count(*)::int calls
      FROM "UsageCost" WHERE "createdAt" >= ${since} AND "benchRun" IS NULL
      GROUP BY 1, 2 ORDER BY 1`,
    prisma.$queryRaw<RevRow[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') d, "productId",
             COALESCE(sum(abs("deltaKrw")),0)::float rev, count(*)::int n
      FROM "CreditTx" WHERE "createdAt" >= ${since} AND "type" = 'CHARGE'
      GROUP BY 1, 2 ORDER BY 1`,
    prisma.product.findMany({ select: { id: true, slug: true, name: true } }),
  ]);

  const pname = new Map(products.map((p) => [p.id, p.name] as const));
  const dayList = [...new Set([...costRows.map((r) => r.d), ...revRows.map((r) => r.d)])].sort();
  const apiIds = [...new Set([...costRows.map((r) => r.productId), ...revRows.map((r) => r.productId)])];

  // API별 집계
  const byApi = apiIds.map((pid) => {
    const cMap = new Map(costRows.filter((r) => r.productId === pid).map((r) => [r.d, r]));
    const rMap = new Map(revRows.filter((r) => r.productId === pid).map((r) => [r.d, r]));
    const cost = dayList.map((d) => cMap.get(d)?.cost ?? 0);
    const rev = dayList.map((d) => rMap.get(d)?.rev ?? 0);
    const calls = dayList.map((d) => cMap.get(d)?.calls ?? 0);
    const tokens = dayList.map((d) => cMap.get(d)?.tokens ?? 0);
    const totalCost = cost.reduce((a, b) => a + b, 0);
    const totalRev = rev.reduce((a, b) => a + b, 0);
    const totalCalls = calls.reduce((a, b) => a + b, 0);
    return { pid, name: pid ? pname.get(pid) ?? pid : "(미지정)", cost, rev, calls, tokens, totalCost, totalRev, totalCalls };
  }).sort((a, b) => b.totalCost - a.totalCost);

  const grandCost = byApi.reduce((s, a) => s + a.totalCost, 0);
  const grandRev = byApi.reduce((s, a) => s + a.totalRev, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>원가 분석 (API별)</h1>
          <p className="purpose">API별 일자별 원가(Gemini) vs 매출(과금) 추이·마진. 최근 {windowDays}일. 원가 급증·마진 역전 모니터링.</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[7, 30, 90].map((d) => (
          <a key={d} className={`btn btn-sm ${d === windowDays ? "" : "btn-secondary"}`} href={`/admin/cost-analysis?days=${d}`}>{d}일</a>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <div className="form-section" style={{ flex: 1, minWidth: 160 }}><h3 className="muted">총 매출</h3><div style={{ fontSize: 22, fontWeight: 700 }}>{won(grandRev)}</div></div>
        <div className="form-section" style={{ flex: 1, minWidth: 160 }}><h3 className="muted">총 원가</h3><div style={{ fontSize: 22, fontWeight: 700 }}>{won(grandCost)}</div></div>
        <div className="form-section" style={{ flex: 1, minWidth: 160 }}><h3 className="muted">마진</h3><div style={{ fontSize: 22, fontWeight: 700, color: grandRev - grandCost >= 0 ? "#15803d" : "#b91c1c" }}>{won(grandRev - grandCost)} <span style={{ fontSize: 13 }}>({grandRev > 0 ? Math.round(((grandRev - grandCost) / grandRev) * 100) : 0}%)</span></div></div>
      </div>

      {byApi.length === 0 ? (
        <div className="empty-state"><h3>데이터 없음</h3><p>추출/검출 호출이 쌓이면 API별 원가·매출이 표시됩니다.</p></div>
      ) : (
        byApi.map((a) => {
          const margin = a.totalRev - a.totalCost;
          const marginPct = a.totalRev > 0 ? Math.round((margin / a.totalRev) * 100) : (a.totalCost > 0 ? -100 : 0);
          const costPerCall = a.totalCalls > 0 ? a.totalCost / a.totalCalls : 0;
          return (
            <div key={a.pid ?? "none"} className="form-section" style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ fontWeight: 700 }}>{a.name}</h3>
                <div style={{ fontSize: 13 }} className="muted">
                  매출 {won(a.totalRev)} · 원가 {won(a.totalCost)} · <b style={{ color: margin >= 0 ? "#15803d" : "#b91c1c" }}>마진 {won(margin)} ({marginPct}%)</b> · 호출당 원가 {costPerCall.toFixed(2)}원 · {a.totalCalls.toLocaleString()}콜
                </div>
              </div>
              <Chart days={dayList} cost={a.cost} rev={a.rev} />
              {margin < 0 && <p style={{ color: "#b91c1c", fontSize: 13, marginTop: 6 }}><AlertTriangle size={14} style={{ verticalAlign: "-2px" }} aria-hidden /> 원가가 매출을 초과합니다(마진 역전) — 단가·모델·무료쿼터 점검 필요.</p>}
            </div>
          );
        })
      )}

      <p className="muted" style={{ fontSize: 12 }}>원가=UsageCost(Gemini 토큰×단가), 매출=CreditTx CHARGE. 벤치마크(benchRun) 분은 제외. 단가표는 pricing.ts(공식 단가 반영).</p>
    </>
  );
}
