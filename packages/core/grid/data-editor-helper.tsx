// @ts-nocheck
import { FieldSchema, FieldType } from '@nadoo/shared';
import {
  AttachmentCell,
  BooleanCell,
  CustomCell,
  EditableGridCell,
  GridCell,
  GridCellKind,
  GridColumn,
  GridColumnIcon,
  ImageCell,
  NumberCell,
  TextCell,
} from './internal/data-grid/data-grid-types';
import starCellRenderer from './cells/star-cell';
import multiSelectCellRenderer from './cells/multi-select-cell';
import dropdownCellRenderer from './cells/dropdown-cell';
import datePickerCellRenderer from './cells/date-picker-cell';
import htmlCellRenderer from './cells/html-cell';
import { SelectOption } from './cells/multi-select-cell';
import moment from 'moment';

const getCellKind = (column: FieldSchema): GridCellKind => {
  switch (column.type) {
    case FieldType.ARRAY:
    case FieldType.NUMERIC_ARRAY:
      return GridCellKind.Custom; // Support array type
    case FieldType.BOOLEAN:
    case FieldType.CHECKBOX:
      return GridCellKind.Boolean;
    case FieldType.NUMBER:
      return GridCellKind.Number;
    case FieldType.IMAGE:
      return GridCellKind.Image;
    case FieldType.ATTACHMENT:
      return GridCellKind.Attachment;
    case FieldType.LINK:
      return GridCellKind.Uri;
    case FieldType.NUMERIC_OPTIONS:
    case FieldType.OPTIONS:
      return GridCellKind.Custom;
    case FieldType.DATETIME:
      return GridCellKind.Custom;
    case FieldType.HTML:
      return GridCellKind.Custom;
    case FieldType.STRING:
      return GridCellKind.Text;
    default:
      return GridCellKind.Text;
  }
};

const getIcon = (column: FieldSchema): GridColumnIcon | string => {
  switch (column.type) {
    case FieldType.ARRAY:
    case FieldType.NUMERIC_ARRAY:
      return GridColumnIcon.HeaderArray;
    case FieldType.BOOLEAN:
    case FieldType.CHECKBOX:
      return GridColumnIcon.HeaderBoolean;
    case FieldType.NUMBER:
      return GridColumnIcon.HeaderNumber;
    case FieldType.IMAGE:
      return GridColumnIcon.HeaderImage;
    case FieldType.ATTACHMENT:
      return GridColumnIcon.HeaderReference;
    case FieldType.LINK:
      return GridColumnIcon.HeaderUri;
    case FieldType.NUMERIC_OPTIONS:
      return GridColumnIcon.HeaderNumber;
    case FieldType.OPTIONS:
      return GridColumnIcon.HeaderString;
    case FieldType.DATETIME:
      return GridColumnIcon.HeaderDate;
    case FieldType.HTML:
      return GridColumnIcon.HeaderCode;
    case FieldType.STRING:
      return GridColumnIcon.HeaderString;
    default:
      return GridColumnIcon.HeaderString;
  }
};

const getArrayValue = (value: any) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      return [value];
    }
  }
  return [value];
};

export function getDate(value: any, format?: string): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const momentDate = moment.utc(value, format);

    return momentDate.isValid() ? momentDate.toDate() : null;
  }
  return null;
}

export function getDateTimeCellFormat(
  format?: string,
): 'datetime-local' | 'date' | 'time' {
  if (!format) return 'datetime-local';
  // 날짜 관련 토큰들
  const dateTokens = [
    'Y',
    'Q',
    'M',
    'D',
    'DDD',
    'Do',
    'DD',
    'YYYY',
    'YY',
    'MM',
    'MMM',
    'MMMM',
    'DD',
    'D',
    'Do',
    'X',
    'x',
  ];

  // 시간 관련 토큰들
  const timeTokens = [
    'H',
    'HH',
    'h',
    'hh',
    'm',
    'mm',
    's',
    'ss',
    'a',
    'A',
    'LTS',
    'LT',
    'Z',
    'ZZ',
  ];

  // 포맷 문자열에 날짜와 시간 토큰이 있는지 확인
  let hasDateToken = false;
  let hasTimeToken = false;

  // 날짜 토큰 검사
  for (const token of dateTokens) {
    if (format.includes(token)) {
      hasDateToken = true;
      break;
    }
  }

  // 시간 토큰 검사
  for (const token of timeTokens) {
    if (format.includes(token)) {
      hasTimeToken = true;
      break;
    }
  }

  // 두 가지 특수 케이스 처리 (L: 날짜만, LT: 시간만, LLL/LLLL: 날짜+시간)
  if (format === 'L' || format === 'l' || format === 'LL' || format === 'll') {
    hasDateToken = true;
    hasTimeToken = false;
  } else if (format === 'LT' || format === 'LTS') {
    hasDateToken = false;
    hasTimeToken = true;
  } else if (
    format === 'LLL' ||
    format === 'lll' ||
    format === 'LLLL' ||
    format === 'llll'
  ) {
    hasDateToken = true;
    hasTimeToken = true;
  }

  if (hasDateToken && hasTimeToken) {
    return 'datetime-local';
  } else if (hasDateToken) {
    return 'date';
  } else if (hasTimeToken) {
    return 'time';
  } else {
    return 'datetime-local';
  }
}

export const getCellContent = (column: FieldSchema, value: any): GridCell => {
  switch (column.type) {
    case FieldType.ARRAY:
    case FieldType.NUMERIC_ARRAY:
      return {
        kind: GridCellKind.Custom,
        allowOverlay: true,
        readonly: column.readonly,
        copyData: getArrayValue(value)?.join(','),
        data: {
          kind: 'multi-select-cell',
          values: getArrayValue(value),
          options: (column.options ?? []).map((option) => ({
            value: option,
            label: option,
          })),
          // options: [
          //     { value: "glide", color: "#ffc38a", label: "Glide" },
          //     { value: "data", color: "#ebfdea", label: "Data" },
          //     { value: "grid", color: "teal", label: "Grid" },
          // ],
          allowDuplicates: false,
          allowCreation: true,
        },
        hoverEffect: false,
      } as CustomCell;
    case FieldType.BOOLEAN:
    case FieldType.CHECKBOX:
      return {
        kind: GridCellKind.Boolean,
        allowOverlay: false,
        readonly: column.readonly,
        displayData: value?.toString(),
        copyData: value?.toString(),
        data: value,
        hoverEffect: false,
      } as BooleanCell;
    case FieldType.NUMBER:
      return {
        kind: GridCellKind.Number,
        allowOverlay: true,
        readonly: column.readonly,
        displayData: value?.toString(),
        copyData: value?.toString(),
        data: value,
        hoverEffect: false,
      } as NumberCell;
    case FieldType.IMAGE:
      return {
        kind: GridCellKind.Image,
        allowOverlay: true,
        readonly: column.readonly,
        displayData: getArrayValue(value),
        copyData: getArrayValue(value)?.join(','),
        data: getArrayValue(value),
        hoverEffect: false,
      } as ImageCell;
    case FieldType.ATTACHMENT:
      return {
        kind: GridCellKind.Attachment,
        allowOverlay: true,
        readonly: column.readonly,
        displayData: getArrayValue(value),
        copyData: getArrayValue(value)?.join(','),
        data: getArrayValue(value),
        hoverEffect: false,
      } as AttachmentCell;
    case FieldType.LINK:
      return {
        kind: GridCellKind.Uri,
        allowOverlay: true,
        readonly: column.readonly,
        displayData: value?.toString(),
        copyData: value?.toString(),
        data: value,
        hoverEffect: false,
      };
    case FieldType.NUMERIC_OPTIONS:
    case FieldType.OPTIONS:
      return {
        kind: GridCellKind.Custom,
        allowOverlay: true,
        readonly: column.readonly,
        displayData: value?.toString(),
        copyData: value?.toString(),
        data: {
          kind: 'dropdown-cell',
          allowedValues: column.options ?? [],
          value: value,
        },
        hoverEffect: false,
      } as CustomCell;
    case FieldType.DATETIME:
      const date = getDate(value, column.format);
      return {
        kind: GridCellKind.Custom,
        allowOverlay: true,
        readonly: column.readonly,
        copyData: date?.getTime()?.toString(), // unix timestamp
        data: {
          kind: 'date-picker-cell',
          date: date instanceof Date ? date : null, // Date 객체로 변환
          displayDate: date ? moment.utc(date).format(column.format) : '', // string (local timezone)
          format: getDateTimeCellFormat(column.format), // date, time, datetime-local
        },
        hoverEffect: false,
      } as CustomCell;
    case FieldType.HTML:
      return {
        kind: GridCellKind.Custom,
        allowOverlay: true,
        readonly: column.readonly,
        displayData: value?.toString(),
        copyData: value?.toString(),
        data: {
          kind: 'html-cell',
          html: value ?? '',
        },
        hoverEffect: false,
      } as CustomCell;
    case FieldType.STRING:
      return {
        kind: GridCellKind.Text,
        allowOverlay: true,
        readonly: column.readonly,
        displayData: value?.toString(),
        copyData: value?.toString(),
        data: value,
        hoverEffect: false,
      } as TextCell;
    default:
      return {
        kind: GridCellKind.Text,
        allowOverlay: true,
        readonly: column.readonly,
        displayData: value?.toString(),
        copyData: value?.toString(),
        data: value,
        hoverEffect: false,
      } as TextCell;
  }
};

export const getCellValue = (cell: EditableGridCell, format?: string): any => {
  if (cell.kind !== GridCellKind.Custom) {
    return cell.data;
  }

  const customCell = cell as CustomCell;
  if (starCellRenderer.isMatch(customCell)) {
    return customCell.data.rating;
  } else if (multiSelectCellRenderer.isMatch(customCell)) {
    return customCell.data.values;
  } else if (dropdownCellRenderer.isMatch(customCell)) {
    const value = customCell.data.value;
    if (typeof value === 'string') {
      return value;
    } else if (typeof value === 'object') {
      return (value as unknown as SelectOption)?.value;
    }
    return value;
  } else if (htmlCellRenderer.isMatch(customCell)) {
    return customCell.data.html;
  } else if (datePickerCellRenderer.isMatch(customCell)) {
    return customCell.data.date;
  } else {
    return cell.data;
  }
};

export const buildGridColumn = (column: FieldSchema): GridColumn => {
  return {
    // icon: getIcon(column), // 아이콘은 필요면 나중에 설정
    id: column.value,
    title: column.caption ?? '',
    allowOverlay: true,
    kind: getCellKind(column),
    width: column.width,
    ...(!column.width && { grow: 1 }),
  } as GridColumn;
};
