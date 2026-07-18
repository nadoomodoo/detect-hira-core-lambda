// @ts-nocheck
import { type Rectangle, type Item } from "../internal/data-grid/data-grid-types";

export type VisibleRegion = Rectangle & {
    /** value in px */
    tx?: number;
    /** value in px */
    ty?: number;
    extras?: {
        selected?: Item;
        /**
         * @deprecated
         */
        freezeRegion?: Rectangle;

        /**
         * All visible freeze regions
         */
        freezeRegions?: readonly Rectangle[];
    };
};
