// @ts-nocheck
import { CustomCell } from "../internal/data-grid/data-grid-types";

interface ArticleCellProps {
  readonly kind: "article-cell";
  readonly markdown: string;
}

export type ArticleCell = CustomCell<ArticleCellProps>;
