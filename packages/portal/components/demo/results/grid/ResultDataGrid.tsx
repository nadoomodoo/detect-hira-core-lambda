"use client";
import dynamic from "next/dynamic";
import type { GridColSpec } from "./GridInner";

// 그리드는 canvas 기반이라 SSR 불가 — 클라이언트에서만 로드(모든 grid import 를 client 로 격리).
const GridInner = dynamic(() => import("./GridInner"), {
  ssr: false,
  loading: () => <div className="muted" style={{ padding: 16, fontSize: 13 }}>표 로딩 중…</div>,
});

export type { GridColSpec };

/** 복사 쉬운 결과 그리드 — 범위선택 + Ctrl/Cmd+C(TSV). */
export function ResultDataGrid(props: { columns: GridColSpec[]; data: (string | number | null)[][]; height?: number }) {
  return <GridInner {...props} />;
}
