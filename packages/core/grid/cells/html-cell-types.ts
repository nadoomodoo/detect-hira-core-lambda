// @ts-nocheck
import { CustomCell } from "../internal/data-grid/data-grid-types";

interface HtmlCellProps {
  readonly kind: "html-cell";
  readonly html: string;
}
export type HtmlCell = CustomCell<HtmlCellProps>;

