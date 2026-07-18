// @ts-nocheck
import * as React from 'react';
import { ImageOverlayEditorStyle } from './image-overlay-editor-style';
import { Carousel } from 'react-responsive-carousel';
import 'react-responsive-carousel/lib/styles/carousel.min.css';
import { EditPencil } from '../../../common/utils';

/** @category Types */
export interface OverlayImageEditorProps {
  readonly urls: readonly string[];
  readonly canWrite: boolean;
  readonly onCancel: () => void;
  readonly onChange: (newImage: string[]) => void;
  readonly onEditClick?: () => void;
  readonly renderImage?: (url: string) => React.ReactNode;
}

/** @category Types */
export interface OverlayAttachmentEditorProps {
  readonly urls: readonly string[];
  readonly canWrite: boolean;
  readonly onCancel: () => void;
  readonly onChange: (newImage: string[]) => void;
}


/** @category Renderers */
export const ImageOverlayEditor: React.FunctionComponent<
  OverlayImageEditorProps
> = (p) => {
  const { urls, canWrite, onChange, onCancel, renderImage } = p;

  const filtered = urls.filter((u) => u !== '');

  if (filtered.length === 0) {
    return null;
  }

  const allowMove = filtered.length > 1;
  return (
    <ImageOverlayEditorStyle data-testid="GDG-default-image-overlay-editor">
      <Carousel
        showArrows={allowMove}
        showThumbs={false}
        swipeable={allowMove}
        emulateTouch={allowMove}
        infiniteLoop={allowMove}
      >
        {filtered.map((url) => {
          const innerContent = renderImage?.(url) ?? (
            <img draggable={false} src={url} />
          );
          return (
            <div className="gdg-centering-container" key={url}>
              {innerContent}
            </div>
          );
        })}
      </Carousel>
      {canWrite && onChange && (
        <button className="gdg-edit-icon" onClick={() => {
          onChange([]);
        }}>
          <EditPencil />
        </button>
      )}
    </ImageOverlayEditorStyle>
  );
};
