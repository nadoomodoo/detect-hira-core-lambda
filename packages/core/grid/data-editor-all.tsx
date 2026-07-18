// @ts-nocheck
import * as React from 'react';
import {
  DataEditor,
  type DataEditorProps,
  type DataEditorRef,
} from './data-editor/data-editor';
import { AllCellRenderers, CustomCellRenderers } from './cells/index';
import { sprites } from './internal/data-grid/sprites';
import ImageWindowLoaderImpl from './common/image-window-loader';
import type { ImageWindowLoader } from './internal/data-grid/image-window-loader-interface';

export interface DataEditorAllProps
  extends Omit<DataEditorProps, 'renderers' | 'imageWindowLoader'> {
  imageWindowLoader?: ImageWindowLoader;
}

const DataEditorAllImpl: React.ForwardRefRenderFunction<
  DataEditorRef,
  DataEditorAllProps
> = (p, ref) => {
  const allSprites = React.useMemo(() => {
    return { ...sprites, ...p.headerIcons };
  }, [p.headerIcons]);

  const imageWindowLoader = React.useMemo(() => {
    return p.imageWindowLoader ?? new ImageWindowLoaderImpl();
  }, [p.imageWindowLoader]);

  return (
    <DataEditor
      {...p}
      renderers={AllCellRenderers}
      customRenderers={CustomCellRenderers}
      headerIcons={allSprites}
      ref={ref}
      imageWindowLoader={imageWindowLoader}
    />
  );
};

export const DataEditorAll = React.forwardRef(DataEditorAllImpl);
