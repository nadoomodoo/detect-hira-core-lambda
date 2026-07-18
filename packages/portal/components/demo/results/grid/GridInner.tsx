"use client";
import { useCallback, useMemo } from "react";
import { DataEditor, GridCellKind, type GridColumn, type GridCell, type Item } from "@platform/grid";

export interface GridColSpec {
  title: string;
  /** number 컬럼은 우측정렬 + 숫자 복사. */
  numeric?: boolean;
  width?: number;
}

/**
 * 벤더링된 glide-data-grid(@platform/grid) 기반 읽기전용 결과 그리드.
 * 엑셀식 범위선택 + Ctrl/Cmd+C 복사(TSV) 지원. 클라이언트 전용(canvas).
 */
export default function GridInner({
  columns,
  data,
  height,
}: {
  columns: GridColSpec[];
  data: (string | number | null)[][];
  height?: number;
}) {
  const gridColumns: GridColumn[] = useMemo(
    () => columns.map((c) => ({ title: c.title, id: c.title, width: c.width ?? 120 })),
    [columns],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const raw = data[row]?.[col];
      const spec = columns[col];
      if (spec?.numeric) {
        const num = typeof raw === "number" ? raw : raw == null || raw === "" ? undefined : Number(raw);
        const disp = num == null || Number.isNaN(num) ? (raw == null ? "" : String(raw)) : num.toLocaleString();
        return {
          kind: GridCellKind.Number,
          data: num,
          displayData: disp,
          allowOverlay: false,
          contentAlign: "right",
        };
      }
      const s = raw == null ? "" : String(raw);
      return { kind: GridCellKind.Text, data: s, displayData: s, allowOverlay: false };
    },
    [data, columns],
  );

  const rows = data.length;
  const h = height ?? Math.min(520, 40 + rows * 34);

  return (
    <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 8, overflow: "hidden" }}>
      <DataEditor
        columns={gridColumns}
        rows={rows}
        getCellContent={getCellContent}
        getCellsForSelection={true}
        rowMarkers="number"
        smoothScrollX
        smoothScrollY
        width="100%"
        height={h}
      />
    </div>
  );
}
