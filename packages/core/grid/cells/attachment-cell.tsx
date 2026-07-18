// @ts-nocheck
/* eslint-disable react/display-name */
import * as React from 'react';
import { getMiddleCenterBias, measureTextCached, roundedRect } from '../internal/data-grid/render/data-grid-lib';
import {
  GridCellKind,
  type BaseGridCell,
  type AttachmentCell,
  Item,
} from '../internal/data-grid/data-grid-types';
import type { BaseDrawArgs, InternalCellRenderer } from './cell-types';
import { blend } from '../internal/data-grid/color-parser';

export const attachmentCellRenderer: InternalCellRenderer<AttachmentCell> = {
  getAccessibilityString: (c) => c.data.join(', '),
  kind: GridCellKind.Attachment,
  needsHover: false,
  useLabel: false,
  needsHoverPosition: false,
  draw: (a) => {
    return drawImage(a, a.cell.displayData ?? a.cell.data);
  },
  measure: (_ctx, cell) => cell.data.length * 50,
  onDelete: (c) => ({
    ...c,
    data: [],
  }),
  provideEditor: () => (p) => {
    const { value, onFinishedEditing, attachmentEditorOverride } = p;

    const AttachmentEditor = attachmentEditorOverride!;

    return (
      <AttachmentEditor
        urls={value.data}
        canWrite={value.readonly !== true}
        onCancel={onFinishedEditing}
        onChange={(attachments) => {
          onFinishedEditing({
            ...value,
            data: attachments,
          });
        }}
      />
    );
  },
  onPaste: (toPaste, cell) => {
    toPaste = toPaste.trim();
    const fragments = toPaste.split(',');
    const uris = fragments
      .map((f) => {
        try {
          new URL(f);
          return f;
        } catch {
          return undefined;
        }
      })
      .filter((x) => x !== undefined) as string[];

    if (
      uris.length === cell.data.length &&
      uris.every((u, i) => u === cell.data[i])
    )
      return undefined;
    return {
      ...cell,
      data: uris,
    };
  },
};

const itemMargin = 4;
export function drawImage(
  args: BaseDrawArgs,
  data: readonly string[],
) {
  const { rect, col, row, theme, ctx, imageLoader } = args;
  const { x, y, height: h, width: w } = rect;
  const rounding = 4;

  const imgHeight = h - theme.cellVerticalPadding * 2;
  const images: (HTMLImageElement | ImageBitmap)[] = [];
  let totalWidth = 0;
  // eslint-disable-next-line unicorn/no-for-loop
  for (let index = 0; index < (data?.length ?? 0); index++) {
    const i = data[index];
    if (!i?.length) continue;
    // NOTE: Placeholder image - company branding removed
    const img = imageLoader.loadOrGetImage('/400.svg', col, row);

    if (img !== undefined) {
      images[index] = img;
      const imgWidth = img.width * (imgHeight / img.height);
      totalWidth += imgWidth + itemMargin;
    }
  }

  if (totalWidth === 0) return;
  totalWidth -= itemMargin;

  let drawX = x + theme.cellHorizontalPadding;
  drawX = Math.floor(x + w / 2 - totalWidth / 2);

  for (const img of images) {
    if (img === undefined) continue; //array is sparse
    const imgWidth = img.width * (imgHeight / img.height);
    if (rounding > 0) {
      ctx.beginPath();
      roundedRect(
        ctx,
        drawX,
        y + theme.cellVerticalPadding,
        imgWidth,
        imgHeight,
        rounding,
      );
      ctx.save();
      ctx.clip();
    }
    ctx.drawImage(
      img,
      drawX,
      y + theme.cellVerticalPadding,
      imgWidth,
      imgHeight,
    );
    if (rounding > 0) {
      ctx.restore();
    }

    drawX += imgWidth + itemMargin;
  }
}
