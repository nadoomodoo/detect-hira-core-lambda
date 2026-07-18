import { ArrowLeft, ArrowRight } from "lucide-react";

/**
 * 어드민 목록 공용 페이저 — 서버 컴포넌트. 다른 쿼리파라미터는 makeHref 로 보존한다.
 * pageCount<=1 이면 아무것도 렌더하지 않는다.
 */
export function Pager({
  current,
  pageCount,
  makeHref,
}: {
  current: number;
  pageCount: number;
  makeHref: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const disabled = { opacity: 0.4, pointerEvents: "none" as const };
  return (
    <div
      className="collection-toolbar"
      style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 12 }}
    >
      {current > 1 ? (
        <a className="btn btn-sm btn-secondary" href={makeHref(current - 1)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ArrowLeft size={14} aria-hidden /> 이전</a>
      ) : (
        <span className="btn btn-sm btn-secondary" style={{ ...disabled, display: "inline-flex", alignItems: "center", gap: 4 }}><ArrowLeft size={14} aria-hidden /> 이전</span>
      )}
      <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>{current} / {pageCount}</span>
      {current < pageCount ? (
        <a className="btn btn-sm btn-secondary" href={makeHref(current + 1)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>다음 <ArrowRight size={14} aria-hidden /></a>
      ) : (
        <span className="btn btn-sm btn-secondary" style={{ ...disabled, display: "inline-flex", alignItems: "center", gap: 4 }}>다음 <ArrowRight size={14} aria-hidden /></span>
      )}
    </div>
  );
}
