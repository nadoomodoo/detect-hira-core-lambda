/**
 * 컬럼 매핑 + 값-패턴 기반 스마트 추출 (컬럼 밀림 복구).
 *
 * nadoo-ocr ocr_service.py 의 COLUMN_MAPPINGS / _smart_extract_from_cells 노하우를 이식.
 * VLM 이 표를 { columns: string[], rows: string[][] } 로 읽어오면,
 *  1) 헤더 텍스트를 표준 필드로 매핑하고,
 *  2) 헤더 매핑이 실패/모호하면 값의 크기·소수점·범위 패턴으로 단가/금액/수량을 재식별한다.
 *
 * EDI 문서마다 집계 방식이 다르다: 총처방량=수량×일수, 별도 수량, 총금액=수량×단가 등.
 * 여기서는 존재하는 값만 매핑하고, 누락/역산은 validate.ts 가 담당한다.
 */

/** 표준 필드. */
export type CanonField =
  | "drugCode"
  | "drugName"
  | "manufacturer"
  | "quantity"
  | "days"
  | "prescribedQty"
  | "unitPrice"
  | "totalAmount"
  | "ignore"; // 순번/단위/구분 등 값 아님 — 재식별 대상에서 제외

/** 매핑된 1행. */
export interface MappedRow {
  rowIndex: number;
  drugCode: string | null;
  drugName: string | null;
  manufacturer: string | null;
  quantity: number | null;
  days: number | null;
  prescribedQty: number | null;
  unitPrice: number | null;
  totalAmount: number | null;
  /** 원본 cell 값 (감사용) */
  raw: Record<string, string>;
  /** 값-패턴 재식별이 적용됐는지 (신뢰도 낮춤 신호) */
  reassigned: boolean;
}

/** 한글 헤더 변형 → 표준 필드. (nadoo-ocr 130+ 변형 이식) */
const COLUMN_MAPPINGS: Record<string, CanonField> = {
  // 약품코드
  코드: "drugCode",
  약제코드: "drugCode",
  품목코드: "drugCode",
  약품코드: "drugCode",
  품목번호: "drugCode",
  청구코드: "drugCode",
  보험코드: "drugCode",
  급여코드: "drugCode",
  표준코드: "drugCode",
  전산코드: "drugCode",
  등록코드: "drugCode",
  제품코드: "drugCode",
  처방코드: "drugCode",
  사용자코드: "drugCode",
  정의코드: "drugCode",
  주성분코드: "drugCode",
  // 약품명 (코드가 이상해도 약품명으로 정산하므로 필수 확보)
  약제명: "drugName",
  약품명: "drugName",
  약품명칭: "drugName",
  품목명: "drugName",
  제품명: "drugName",
  품명: "drugName",
  약명: "drugName",
  명칭: "drugName",
  처방명: "drugName",
  처방명칭: "drugName",
  청구명칭: "drugName",
  한글명칭: "drugName",
  성분명: "drugName",
  의약품명: "drugName",
  // 제약사
  제약사: "manufacturer",
  제조사: "manufacturer",
  업체명: "manufacturer",
  제조업체: "manufacturer",
  공급사: "manufacturer",
  메이커: "manufacturer",
  // 단가
  단가: "unitPrice",
  약가: "unitPrice",
  공급단가: "unitPrice",
  판매단가: "unitPrice",
  표준단가: "unitPrice",
  공급가: "unitPrice",
  가격: "unitPrice",
  보험단가: "unitPrice",
  급여단가: "unitPrice",
  상한금액: "unitPrice",
  수가: "unitPrice",
  // 수량(1회/건당 개수 성격) — 처방횟수·환자수·건수 포함
  수량: "quantity",
  공급수량: "quantity",
  주문수량: "quantity",
  출고수량: "quantity",
  납품수량: "quantity",
  처방횟수: "quantity",
  환자수: "quantity",
  건수: "quantity",
  // 일수
  일수: "days",
  투약일수: "days",
  처방일수: "days",
  총일수: "days",
  // 총처방량(집계 총량) — 총사용량/총투여량/총소모량/총수량
  총처방량: "prescribedQty",
  "총 처방량": "prescribedQty",
  처방량: "prescribedQty",
  처방수량: "prescribedQty",
  총사용량: "prescribedQty",
  총투여량: "prescribedQty",
  총투여: "prescribedQty", // [약품코드통계] 등 "량" 없이 쓰는 헤더
  총소모량: "prescribedQty",
  총수량: "prescribedQty",
  총투약량: "prescribedQty",
  총투약: "prescribedQty",
  집계량: "prescribedQty",
  사용량: "prescribedQty",
  투여량: "prescribedQty",
  투약량: "prescribedQty",
  // 순번/단위/구분 등 — 값 아님(수량으로 오인 금지)
  순번: "ignore",
  연번: "ignore",
  번호: "ignore",
  단위: "ignore",
  과목: "ignore",
  구분: "ignore",
  내외: "ignore",
  원내: "ignore",
  원외: "ignore",
  // 총금액
  금액: "totalAmount",
  급액: "totalAmount",
  "총 금액": "totalAmount",
  총금액: "totalAmount",
  공급금액: "totalAmount",
  판매금액: "totalAmount",
  합계금액: "totalAmount",
  공급가액: "totalAmount",
  납품금액: "totalAmount",
  청구금액: "totalAmount",
  보험금액: "totalAmount",
};

/** 결합 컬럼 — "청구코드 명칭" → [코드, 이름] 분리. */
const COMBINED_HEADERS = new Set(["청구코드 명칭", "약품코드 명칭", "코드 명칭", "약품코드 약품명"]);

/** 헤더 문자열 정규화(공백/특수문자 제거) 후 표준 필드 반환. */
export function mapHeader(header: string): CanonField | null {
  // 괄호/대괄호 안 부연설명 제거 후 정규화 — "금액(집계량x수가)" → "금액"(총금액)
  const h = (header ?? "")
    .normalize("NFKC")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[\s()[\]:·.]/g, "")
    .trim();
  if (!h) return null;
  // 행번호 헤더(No/NO/순번 등)는 값 아님
  if (/^no$/i.test(h)) return "ignore";
  if (COLUMN_MAPPINGS[h]) return COLUMN_MAPPINGS[h];
  // 부분 포함 매칭 (긴 키 우선)
  const keys = Object.keys(COLUMN_MAPPINGS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (h.includes(k.replace(/\s/g, ""))) return COLUMN_MAPPINGS[k];
  }
  return null;
}

/** 숫자 컬럼 종류 — 구분자(. ,) 해석이 다르다. */
export type NumKind = "money" | "count" | "generic";

/**
 * 컬럼 인식 숫자 파싱.
 *  - money(금액/단가): '.' ',' 는 원칙적으로 천단위 구분. 단 소수 1~2자리(원 미만/부분수량)는 소수점.
 *  - count(수량/총처방량/일수): '.' 는 소수점(예: 593.5, 40.65), ',' 는 천단위.
 * 규칙(로케일 인식):
 *  - , 와 . 가 함께 있으면 마지막 구분자가 소수점, 나머지는 천단위.
 *  - , 만 있으면 천단위(한국 관례) → 제거.
 *  - . 만 있으면: 2개 이상 → 천단위(유럽식) 제거 / 1개 → money & 소수부 3자리면 천단위, 그 외 소수점.
 */
export function parseNumber(
  v: string | number | null | undefined,
  kind: NumKind = "generic",
): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[\s₩원 ]/g, "").trim();
  s = s.replace(/[^0-9.,\-]/g, ""); // 숫자·구분자·부호만
  if (!s || s === "-" || s === "." || s === ",") return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // 마지막 구분자 = 소수점, 나머지 = 천단위
    const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, "");
    const decPart = s.slice(lastSep + 1).replace(/[.,]/g, "");
    s = `${intPart}.${decPart}`;
  } else if (hasComma) {
    s = s.replace(/,/g, ""); // 한국: 콤마=천단위
  } else if (hasDot) {
    const dots = (s.match(/\./g) || []).length;
    if (dots > 1) {
      s = s.replace(/\./g, ""); // 점 여러 개 = 천단위(유럽식)
    } else {
      const after = s.split(".")[1] ?? "";
      // 소수부가 정확히 3자리면 천단위 구분(417.410→417410, 1.168→1168) — money·count 공통.
      // 1~2자리는 소수점(3292.65, 593.5, 40.65) — 부분수량/원미만 보존.
      // 한국/유럽 표기에서 소수 3자리는 사실상 없고 천단위 구분이므로 종류 무관 적용.
      if (after.length === 3) s = s.replace(/\./g, "");
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 9자리(±) 약가코드 추출 — 셀에서 8~10자리 숫자 덩어리. */
function extractCode(v: string): string | null {
  const m = String(v ?? "").match(/\b(\d{8,10})\b/);
  return m ? m[1] : null;
}

/** 소수점 포함 여부. */
function hasDecimal(v: string): boolean {
  return /\d\.\d/.test(String(v ?? ""));
}

/**
 * 헤더-값 매핑. 헤더가 표준 필드로 매핑되면 그대로 사용.
 * 매핑 안 된 숫자 컬럼이 남으면 값-패턴으로 단가/금액/수량 재식별(컬럼 밀림 복구).
 */
export function mapRow(columns: string[], cells: string[], rowIndex: number): MappedRow {
  const row: MappedRow = {
    rowIndex,
    drugCode: null,
    drugName: null,
    manufacturer: null,
    quantity: null,
    days: null,
    prescribedQty: null,
    unitPrice: null,
    totalAmount: null,
    raw: {},
    reassigned: false,
  };

  const unmappedNumeric: { header: string; value: string; num: number; money: number; count: number }[] = [];

  for (let i = 0; i < columns.length; i++) {
    const header = columns[i] ?? `col${i}`;
    const cell = (cells[i] ?? "").toString().trim();
    row.raw[header] = cell;
    if (!cell) continue;

    // 결합 컬럼: "647300350 모사피아정" → 코드 + 이름
    if (COMBINED_HEADERS.has(header.trim())) {
      const code = extractCode(cell);
      if (code) {
        row.drugCode = code;
        row.drugName = cell.replace(code, "").trim() || row.drugName;
        continue;
      }
    }

    const field = mapHeader(header);
    if (field === "ignore") {
      continue; // 순번/단위/구분 등 — 값으로 쓰지 않음(수량 오인 방지)
    } else if (field === "drugCode") {
      row.drugCode = extractCode(cell) ?? cell;
    } else if (field === "drugName") {
      row.drugName = cell;
    } else if (field === "manufacturer") {
      row.manufacturer = cell;
    } else if (field === "quantity" || field === "days" || field === "prescribedQty" || field === "unitPrice" || field === "totalAmount") {
      const kind: NumKind = field === "unitPrice" || field === "totalAmount" ? "money" : "count";
      const n = parseNumber(cell, kind);
      if (n !== null) (row as any)[field] = n;
    } else {
      // 매핑 안 됨 — 숫자면 재식별 후보로 (money/count 파싱 병기)
      const n = parseNumber(cell);
      if (n !== null && !extractCode(cell)) {
        unmappedNumeric.push({
          header,
          value: cell,
          num: n,
          money: parseNumber(cell, "money") ?? n,
          count: parseNumber(cell, "count") ?? n,
        });
      } else if (!row.drugCode) {
        const code = extractCode(cell);
        if (code) row.drugCode = code;
      }
    }
  }

  // 값-패턴 재식별: 헤더 매핑으로 단가/금액/수량이 비어있는데 미매핑 숫자가 있으면 복구.
  // 규칙(nadoo-ocr): 총금액=가장 큰 수(보통 ≥ 10,000), 단가=소수점 있거나 100~50,000,
  //                  수량=정수 1~9,999(행번호 성격 제외).
  if (unmappedNumeric.length > 0 && (row.unitPrice === null || row.totalAmount === null || row.quantity === null)) {
    // money 파싱값 기준 내림차순(천단위 구분 반영)
    const sorted = [...unmappedNumeric].sort((a, b) => b.money - a.money);

    // 총금액: 미배정이면 가장 큰 값(money 파싱)이 10,000 이상일 때
    if (row.totalAmount === null) {
      const cand = sorted.find((c) => c.money >= 10000);
      if (cand) {
        row.totalAmount = cand.money;
        row.reassigned = true;
        remove(sorted, cand);
      }
    }
    // 단가: money 파싱 100~50,000 범위
    if (row.unitPrice === null) {
      const cand = sorted.find((c) => c.money >= 100 && c.money <= 50000);
      if (cand) {
        row.unitPrice = cand.money;
        row.reassigned = true;
        remove(sorted, cand);
      }
    }
    // 수량: 남은 것 중 count 파싱 정수 1~9,999
    if (row.quantity === null) {
      const cand = sorted.find((c) => Number.isInteger(c.count) && c.count >= 1 && c.count <= 9999);
      if (cand) {
        row.quantity = cand.count;
        row.reassigned = true;
        remove(sorted, cand);
      }
    }
  }

  return row;
}

function remove<T>(arr: T[], item: T): void {
  const i = arr.indexOf(item);
  if (i !== -1) arr.splice(i, 1);
}

/** 합계/소계/요약 행 판별 — 약품 항목이 아니므로 추출 결과에서 분리한다.
 * 근거: 코드가 없고, 원본 셀 어딘가에 합계/소계/총계/계/합 표기가 있음(금액만 큰 행). */
export function isSummaryRow(row: MappedRow): boolean {
  if (row.drugCode) return false; // 코드가 있으면 항목 행
  const joined = [...Object.values(row.raw), row.drugName ?? ""].join(" ");
  if (/(합\s*계|소\s*계|총\s*계|누\s*계|^\s*계\s*$|\b계\b|약품건수|품목수|총건수)/.test(joined)) return true;
  // 코드 없이 이름이 제약사명(제약/바이오팜/파마/약품공업/주식회사/㈜)인 소계 행
  const name = (row.drugName ?? "").trim();
  if (name && /(제약|바이오팜|바이오|파마|약품공업|헬스케어|주식회사|㈜|\(주\))\s*$/.test(name)) return true;
  return false;
}

/** 빈 행 판별 — 코드·약품명·모든 숫자값이 없는 행(빈 No. 줄 등). 항목 아님. */
export function isEmptyRow(row: MappedRow): boolean {
  if (row.drugCode || row.drugName) return false;
  return (
    row.quantity === null &&
    row.days === null &&
    row.prescribedQty === null &&
    row.unitPrice === null &&
    row.totalAmount === null
  );
}

/**
 * VLM 원본 출력({columns, rows})을 MappedRow[] 로 변환.
 * rows 는 string[][] (셀 배열) 또는 object[] (헤더 키) 둘 다 허용.
 */
export function mapTable(
  columns: string[],
  rows: Array<string[] | Record<string, unknown>>,
): MappedRow[] {
  return rows.map((r, idx) => {
    let cells: string[];
    if (Array.isArray(r)) {
      cells = r.map((c) => (c === null || c === undefined ? "" : String(c)));
    } else {
      cells = columns.map((col) => {
        const v = (r as Record<string, unknown>)[col];
        return v === null || v === undefined ? "" : String(v);
      });
    }
    return mapRow(columns, cells, idx);
  });
}
