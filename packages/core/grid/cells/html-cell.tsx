// @ts-nocheck
import * as React from 'react';
import { CustomRenderer } from './cell-types';
import { GridCellKind } from '../internal/data-grid/data-grid-types';
import { getMiddleCenterBias } from '../internal/data-grid/render/data-grid-lib';
import { HtmlCell } from './html-cell-types';

const HtmlCellEditor = React.lazy(
  async () => await import('./html-cell-editor'),
);

const renderer: CustomRenderer<HtmlCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is HtmlCell => (c.data as any).kind === 'html-cell',
  draw: (args, cell) => {
    const { ctx, theme, rect } = args;
    const { html } = cell.data;

    let data = html;
    if (data.includes('\n')) {
      // new lines are rare and split is relatively expensive compared to the search
      // it pays off to not do the split contantly.
      data = data.split(/\r?\n/)[0];
    }
    const max = rect.width / 4; // no need to round, slice will just truncate this
    if (data.length > max) {
      data = data.slice(0, max);
    }

    ctx.fillStyle = theme.textDark;
    ctx.fillText(
      data,
      rect.x + theme.cellHorizontalPadding,
      rect.y + rect.height / 2 + getMiddleCenterBias(ctx, theme),
    );

    return true;
  },
  provideEditor: () => ({
    editor: (p) => {
      return (
        <React.Suspense fallback={null}>
          <HtmlCellEditor {...p} />
        </React.Suspense>
      );
    },
    styleOverride: {
      position: 'fixed',
      left: '30vw',
      top: '12.5vh',
      width: '75vw',
      maxWidth: 'unset',
      maxHeight: 'unset',
    },
    disablePadding: true,
  }),
  onPaste: (val, d) => ({
    ...d,
    html: val,
  }),
};
export default renderer;
