// @ts-nocheck
// Type declarations for external modules used by the Glide Data Grid fork

declare module '@emotion/styled' {
  import { CreateStyled } from '@emotion/styled/types/index';
  const styled: CreateStyled;
  export default styled;
}

declare module '@toast-ui/react-editor' {
  export const Editor: any;
}

declare module 'react-select' {
  export const components: any;
  export type Props = any;
  const Select: any;
  export default Select;
}

declare module 'react-select/creatable' {
  const CreatableSelect: any;
  export default CreatableSelect;
}

declare module 'react-responsive-carousel' {
  export const Carousel: any;
}

declare module 'react-number-format' {
  export const NumericFormat: any;
}

declare module 'marked' {
  export function marked(text: string): string;
}

declare module 'moment' {
  const moment: any;
  export default moment;
}

declare module '@nadoo/shared' {
  export function formatCurrency(value: number): string;
  export function formatDate(date: Date | string, format?: string): string;
  export const theme: any;
}

// Fix for deprecated React.VFC
declare namespace React {
  type VFC<P = {}> = React.FC<P>;
}
