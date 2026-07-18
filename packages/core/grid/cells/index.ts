// @ts-nocheck
// Minimal cell renderers - only essential types without external dependencies
import { type InnerGridCell } from "../internal/data-grid/data-grid-types";
import { booleanCellRenderer } from "./boolean-cell";
import type { InternalCellRenderer, CustomRenderer } from "./cell-types";
import { loadingCellRenderer } from "./loading-cell";
import { markerCellRenderer } from "./marker-cell";
import { newRowCellRenderer } from "./new-row-cell";
import { numberCellRenderer } from "./number-cell";
import { protectedCellRenderer } from "./protected-cell";
import { rowIDCellRenderer } from "./row-id-cell";
import { textCellRenderer } from "./text-cell";
import { uriCellRenderer } from "./uri-cell";
import buttonCellRenderer from "./button-cell";

// Essential cell renderers only (Text, Number, Boolean, URI, etc.)
export const AllCellRenderers = [
  markerCellRenderer,
  newRowCellRenderer,
  booleanCellRenderer,
  loadingCellRenderer,
  numberCellRenderer,
  protectedCellRenderer,
  rowIDCellRenderer,
  textCellRenderer,
  uriCellRenderer,
] as InternalCellRenderer<InnerGridCell>[];

export const CustomCellRenderers: CustomRenderer<any>[] = [
  buttonCellRenderer,
];
