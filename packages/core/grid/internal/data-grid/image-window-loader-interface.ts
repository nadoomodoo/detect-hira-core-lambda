// @ts-nocheck
import type { CellSet } from "./cell-set";
import type { Rectangle } from "./data-grid-types";

/** @category Types */
export interface ImageWindowLoader {
    setWindow(newWindow: Rectangle, freezeCols: number, freezeRows: number[]): void;
    loadOrGetImage(url: string, col: number, row: number): HTMLImageElement | ImageBitmap | undefined;
    setCallback(imageLoaded: (locations: CellSet) => void): void;
}
