type Kind = "success" | "info" | "warning" | "error" | "neutral";

/** design.md 상태 어휘 — 색 + 텍스트 (색 단독 금지). */
export function StatusBadge({ kind, label }: { kind: Kind; label: string }) {
  return <span className={`status status-${kind}`}>{label}</span>;
}

export const PRODUCT_STATUS: Record<string, { kind: Kind; label: string }> = {
  ACTIVE: { kind: "success", label: "활성" },
  BETA: { kind: "info", label: "베타" },
  DEPRECATED: { kind: "neutral", label: "종료" },
};

export const REQ_STATUS: Record<string, { kind: Kind; label: string }> = {
  NEW: { kind: "warning", label: "신규" },
  CONTACTED: { kind: "info", label: "연락함" },
  APPROVED: { kind: "success", label: "승인" },
  REJECTED: { kind: "neutral", label: "반려" },
};
