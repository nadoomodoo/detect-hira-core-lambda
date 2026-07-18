// @ts-nocheck
// Minimal Glide Data Grid exports - only essential functionality
export type { SpriteMap, HeaderIcon, Sprite } from "./internal/data-grid/data-grid-sprites";
export type { SpriteProps } from "./common/utils";
export type { Theme } from "./common/styles";
export type { CustomRenderer, BaseDrawArgs, DrawArgs } from "./cells/cell-types";
export type { SelectionBlending } from "./internal/data-grid/use-selection-behavior";
export type { GetRowThemeCallback, Highlight } from "./internal/data-grid/render/data-grid-render.cells";
export type { ImageWindowLoader } from "./internal/data-grid/image-window-loader-interface";
export * from "./internal/data-grid/data-grid-types";
export type {
  BaseGridMouseEventArgs,
  CellClickedEventArgs,
  DragHandler,
  FillPatternEventArgs,
  GridDragEventArgs,
  GridKeyEventArgs,
  GridMouseCellEventArgs,
  GridMouseEventArgs,
  GridMouseGroupHeaderEventArgs,
  GridMouseHeaderEventArgs,
  GridMouseOutOfBoundsEventArgs,
  GroupHeaderClickedEventArgs,
  HeaderClickedEventArgs,
  OutOfBoundsRegionAxis,
  PositionableMouseEventArgs,
  PreventableEvent,
} from "./internal/data-grid/event-args";
export { GrowingEntry as TextCellEntry } from "./internal/growing-entry/growing-entry";
export { parseToRgba, withAlpha, blend, interpolateColors, getLuminance } from "./internal/data-grid/color-parser";
export {
  measureTextCached,
  getMiddleCenterBias,
  roundedPoly,
  roundedRect,
  drawTextCellExternal as drawTextCell,
} from "./internal/data-grid/render/data-grid-lib";
export { CellSet } from "./internal/data-grid/cell-set";
export { getDataEditorTheme as getDefaultTheme, useTheme } from "./common/styles";
export { useColumnSizer } from "./data-editor/use-column-sizer";

export type { DataEditorRef } from "./data-editor/data-editor";
export { DataEditorAll as DataEditor } from "./data-editor-all";
export type { DataEditorAllProps as DataEditorProps } from "./data-editor-all";

export { DataEditor as DataEditorCore } from "./data-editor/data-editor";
export type { DataEditorProps as DataEditorCoreProps } from "./data-editor/data-editor";

// Essential cell renderers only
export { booleanCellRenderer } from "./cells/boolean-cell";
export { numberCellRenderer } from "./cells/number-cell";
export { textCellRenderer } from "./cells/text-cell";
export { uriCellRenderer } from "./cells/uri-cell";
export { loadingCellRenderer } from "./cells/loading-cell";
export { newRowCellRenderer } from "./cells/new-row-cell";
export { markerCellRenderer } from "./cells/marker-cell";
export { protectedCellRenderer } from "./cells/protected-cell";
export { rowIDCellRenderer } from "./cells/row-id-cell";
export { AllCellRenderers } from "./cells/index";
export { sprites } from "./internal/data-grid/sprites";
export { default as ImageWindowLoaderImpl } from "./common/image-window-loader";
export * from "./data-editor/copy-paste";

export { useRowGrouping } from "./data-editor/row-grouping-api";
export type {
  RowGroupingMapper,
  RowGroupingMapperResult,
  UseRowGroupingResult,
} from "./data-editor/row-grouping-api";
export type { RowGroup, RowGroupingOptions } from "./data-editor/row-grouping";

/**
 * @category DataEditor
 * @hidden
 */
export { DataEditorAll as default } from "./data-editor-all";