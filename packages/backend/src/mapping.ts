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
  | "quantityPart" // 총 처방횟수의 세부(급여/비급여) — 합계검산용
  | "prescribedQtyPart" // 총 처방량의 세부(급여/비급여) — 합계검산용
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
  /** 총 처방횟수 세부(급여/비급여 등) — 합계검산용(합=quantity). */
  quantityParts?: number[];
  /** 총 처방량 세부(급여/비급여 등) — 합계검산용(합=prescribedQty). */
  prescribedQtyParts?: number[];
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
  투여횟수: "quantity",
  총투여횟수: "quantity", // "총투여" 부분매칭(총처방량)보다 우선하도록 정확 매핑
  총투약횟수: "quantity",
  총횟수: "quantity",
  // 총 처방횟수 세부(급여/비급여) — 합계검산용(급여+비급여=총). 총계는 quantity 로 별도 매핑.
  급여처방횟수: "quantityPart",
  비급여처방횟수: "quantityPart",
  // 일수
  일수: "days",
  투약일수: "days",
  처방일수: "days",
  총일수: "days",
  // 총처방량(집계 총량) — 총사용량/총투여량/총소모량/총수량
  총처방량: "prescribedQty",
  "총 처방량": "prescribedQty",
  // 총 처방량 세부(급여/비급여) — 합계검산용(급여+비급여=총).
  급여처방량: "prescribedQtyPart",
  비급여처방량: "prescribedQtyPart",
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
  단가적용: "ignore", // 급여/비급여 표시 — "단가" 부분매칭(단가)으로 오인 방지
  약품분류: "ignore", // 분류코드(숫자) — 값패턴 재식별에서 수량 오인 방지
  약효분류: "ignore",
  분류: "ignore",
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
  // 비율/구성비/점유율/백분율 컬럼은 값 아님 — "처방횟수비율"이 "처방횟수"(수량),
  // "처방량비율"이 "처방량"(총처방량)으로 부분매칭돼 실제 집계값을 덮어쓰는 것을 차단.
  if (/비율|구성비|점유율|백분율|%/.test(h)) return "ignore";
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

/** 표준 HIRA 약가코드(8~10자리 순수 숫자) 여부. */
function isHiraCode(v: string | null | undefined): boolean {
  return /^\d{8,10}$/.test((v ?? "").trim());
}

/**
 * 두 코드가 OCR 절단/접두 관계(=같은 물리 코드의 다른 표현)인지.
 * 검출(좌표) 9자리 코드로 표의 잘린 코드를 교정할 때 사용.
 * 규칙: 숫자만 비교, 6자리 이상, 한쪽이 다른쪽의 접두이고 길이차 ≤2. (완전 동일은 false)
 */
export function codesMatchByTruncation(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? "").replace(/\D/g, "");
  const db = (b ?? "").replace(/\D/g, "");
  if (da.length < 6 || db.length < 6 || da === db) return false;
  const [short, long] = da.length <= db.length ? [da, db] : [db, da];
  return long.startsWith(short) && long.length - short.length <= 2;
}

const approxEqN = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.02);

/**
 * 헤더 없는/부실한 표에서 마스터 약가를 앵커로 숫자 컬럼의 "역할"을 추정한다(값은 지어내지 않음).
 *  1) 코드 열의 약가(masterPriceByRow)와 값이 일치하는 열 → 단가 열
 *  2) 나머지 열 중 A ≈ B × 단가 관계가 성립하면 A=총금액, B=수량|총처방량(정수면 수량, 소수면 총처방량)
 * 추정된 열의 헤더 라벨만 정규명으로 바꿔 반환(그 라벨로 mapTable 재실행). 앵커(단가) 못 잡으면 미변경.
 * cellsRows·masterPriceByRow 는 행 정렬. min 은 판정에 필요한 최소 일치 행 수.
 */
export function inferColumnRolesByMaster(
  columns: string[],
  cellsRows: string[][],
  masterPriceByRow: (number | null)[],
  min = 3,
): { columns: string[]; changed: boolean } {
  const nCols = Math.max(columns.length, ...cellsRows.map((r) => r.length), 0);
  // 열별 숫자값(행 정렬) + 코드/이름 열 제외 대상 판별
  const val: (number | null)[][] = [];
  const isCodeCol: boolean[] = [];
  for (let c = 0; c < nCols; c++) {
    const col = cellsRows.map((r) => parseNumber(r[c] ?? "", "generic"));
    val.push(col);
    const codeHits = cellsRows.filter((r) => isHiraCode((r[c] ?? "").trim())).length;
    isCodeCol[c] = cellsRows.length > 0 && codeHits >= cellsRows.length / 2;
  }
  const numericCols = Array.from({ length: nCols }, (_, c) => c).filter(
    (c) => !isCodeCol[c] && val[c].filter((v) => v != null).length >= min,
  );

  // 1) 단가 열 — 마스터 약가와 최다 일치
  let priceCol = -1;
  let priceHits = 0;
  for (const c of numericCols) {
    let hits = 0;
    for (let i = 0; i < cellsRows.length; i++) {
      const mp = masterPriceByRow[i];
      if (mp != null && mp > 0 && val[c][i] != null && approxEqN(val[c][i]!, mp)) hits++;
    }
    if (hits > priceHits) { priceHits = hits; priceCol = c; }
  }
  if (priceCol < 0 || priceHits < min) return { columns, changed: false };

  const out = [...columns];
  while (out.length < nCols) out.push(`col${out.length}`);
  out[priceCol] = "단가";
  let changed = true;

  // 2) 총금액·수량(총처방량) — A ≈ B × 단가
  const rest = numericCols.filter((c) => c !== priceCol);
  let best: { amount: number; mult: number; hits: number } | null = null;
  for (const a of rest) {
    for (const m of rest) {
      if (a === m) continue;
      let hits = 0;
      for (let i = 0; i < cellsRows.length; i++) {
        const p = val[priceCol][i];
        if (p != null && val[a][i] != null && val[m][i] != null && approxEqN(val[a][i]!, val[m][i]! * p)) hits++;
      }
      if (hits >= min && (!best || hits > best.hits)) best = { amount: a, mult: m, hits };
    }
  }
  if (best) {
    out[best.amount] = "총금액";
    const allInt = val[best.mult].filter((v) => v != null).every((v) => Number.isInteger(v));
    out[best.mult] = allInt ? "수량" : "총처방량";
  }
  return { columns: out, changed };
}

/** 약품명 앞/뒤에 붙은 8~10자리 표준코드 분리 — "651902140 토파메이트정..." → {code, rest}. */
function splitEmbeddedCode(name: string): { code: string; rest: string } | null {
  const t = name.trim();
  // 앞머리 코드: "651902140 토파메이트정25밀리그램..."
  let m = t.match(/^(\d{8,10})[\s.\-_)\]]+(\S.*)$/);
  if (m) return { code: m[1], rest: m[2].trim() };
  // 꼬리 코드: "토파메이트정... (651902140)"
  m = t.match(/^(.*\S)[\s.\-_(\[]+(\d{8,10})[)\]]?$/);
  if (m) return { code: m[2], rest: m[1].trim() };
  return null;
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
      // 코드 컬럼이 둘(처방코드=내부코드 + 청구코드=표준 약가코드)이면 표준 9자리를 우선.
      // 표준코드는 항상 덮어쓰고, 비표준(내부)코드는 아직 코드가 없을 때만 채운다(순서 무관).
      const code = extractCode(cell);
      if (code) row.drugCode = code;
      else if (!row.drugCode) row.drugCode = cell;
    } else if (field === "drugName") {
      row.drugName = cell;
    } else if (field === "manufacturer") {
      row.manufacturer = cell;
    } else if (field === "quantity" || field === "days" || field === "prescribedQty" || field === "unitPrice" || field === "totalAmount") {
      const kind: NumKind = field === "unitPrice" || field === "totalAmount" ? "money" : "count";
      const n = parseNumber(cell, kind);
      if (n !== null) (row as any)[field] = n;
    } else if (field === "quantityPart" || field === "prescribedQtyPart") {
      // 급여/비급여 세부 — 합계검산용으로 수집(합=총계). 값칸으로는 쓰지 않음.
      const n = parseNumber(cell, "count");
      if (n !== null) {
        const key = field === "quantityPart" ? "quantityParts" : "prescribedQtyParts";
        ((row as any)[key] ??= []).push(n);
      }
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

  // 표준 약가코드 승격: drugCode 가 비표준(내부코드/미검출)인데, 표준 9자리 약가코드가
  // 다른 비숫자 셀(약품명·미매핑 코드 컬럼 등)로 밀려 들어간 경우 복구한다.
  // 청구코드(약가코드)가 처방코드와 분리 인식되지 못하거나 컬럼이 밀렸을 때 마스터 조회를 살린다.
  // 금액/단가/수량 등 숫자 컬럼은 대상에서 제외해 8자리 금액을 코드로 오인하지 않는다.
  if (!isHiraCode(row.drugCode)) {
    const NUMERIC_FIELDS = new Set<CanonField>(["quantity", "days", "prescribedQty", "unitPrice", "totalAmount"]);
    const candidates: string[] = [];
    if (row.drugName) candidates.push(row.drugName);
    for (const [header, cell] of Object.entries(row.raw)) {
      const f = mapHeader(header);
      if (f && NUMERIC_FIELDS.has(f)) continue; // 금액/단가/수량 셀은 코드 아님
      candidates.push(cell);
    }
    for (const c of candidates) {
      const t = c.trim();
      // 순수 8~10자리(코드만 든 셀)만 승격 — 이름+코드 혼재/금액 오인 방지.
      if (isHiraCode(t) && t !== row.drugCode) {
        row.drugCode = t;
        row.reassigned = true;
        break;
      }
    }
    // 순수 셀에 표준코드가 없으면, 약품명 앞/뒤에 붙은 8~10자리 코드를 분리 승격.
    // (예: 약품명="651902140 토파메이트정..." + drugCode=내부코드/형식불명)
    if (!isHiraCode(row.drugCode) && row.drugName) {
      const split = splitEmbeddedCode(row.drugName);
      if (split && split.rest) {
        row.drugCode = split.code; // 651902140 → 마스터 조회 가능
        row.drugName = split.rest; // "토파메이트정25밀리그램..." 로 정리
        row.reassigned = true; // 재식별 신호(신뢰도 낮춤 → 확인 대상)
      }
    }
  }

  // 값-패턴 재식별: 헤더 매핑으로 단가/금액/수량이 비어있는데 미매핑 숫자가 있으면 복구.
  // 우선순위: (1) 산술 정합성(총금액÷수량=단가, 총금액÷단가=수량) — 근거 있는 특정,
  //           (2) 범위 휴리스틱 폴백. 범위만 쓰면 단가 100~50000 밖(마스터 12%)·일수/수량 혼동 위험.
  if (unmappedNumeric.length > 0 && (row.unitPrice === null || row.totalAmount === null || row.quantity === null)) {
    // money 파싱값 기준 내림차순(천단위 구분 반영)
    const sorted = [...unmappedNumeric].sort((a, b) => b.money - a.money);
    // 기대값 대비 ±2%(최소 1) 오차 내에서 가장 가까운 후보 선택.
    const closest = (getVal: (c: (typeof sorted)[number]) => number, exp: number) => {
      if (!(exp > 0)) return undefined;
      const tol = Math.max(1, exp * 0.02);
      return sorted
        .filter((c) => Math.abs(getVal(c) - exp) <= tol)
        .sort((a, b) => Math.abs(getVal(a) - exp) - Math.abs(getVal(b) - exp))[0];
    };
    const take = (cand: (typeof sorted)[number] | undefined, field: "unitPrice" | "quantity", val: number) => {
      if (!cand) return;
      (row as any)[field] = val;
      row.reassigned = true;
      remove(sorted, cand);
    };

    // 총금액: 미배정이면 가장 큰 값(money 파싱)이 10,000 이상일 때
    if (row.totalAmount === null) {
      const cand = sorted.find((c) => c.money >= 10000);
      if (cand) { row.totalAmount = cand.money; row.reassigned = true; remove(sorted, cand); }
    }
    // 단가: ① 총금액÷수량(or 총처방량) 기대값에 가장 가까운 후보 → ② 범위(20~50,000) 폴백
    if (row.unitPrice === null) {
      const qtyBase = row.prescribedQty ?? row.quantity;
      if (row.totalAmount != null && qtyBase != null && qtyBase > 0) {
        const cand = closest((c) => c.money, row.totalAmount / qtyBase);
        take(cand, "unitPrice", cand?.money ?? 0);
      }
      if (row.unitPrice === null) {
        const cand = sorted.find((c) => c.money >= 20 && c.money <= 50000);
        take(cand, "unitPrice", cand?.money ?? 0);
      }
    }
    // 수량: ① 총금액÷단가 기대 정수값에 가장 가까운 후보 → ② 정수 1~9,999 폴백
    if (row.quantity === null) {
      if (row.totalAmount != null && row.unitPrice != null && row.unitPrice > 0) {
        const cand = closest((c) => c.count, row.totalAmount / row.unitPrice);
        take(cand, "quantity", cand?.count ?? 0);
      }
      if (row.quantity === null) {
        const cand = sorted.find((c) => Number.isInteger(c.count) && c.count >= 1 && c.count <= 9999);
        take(cand, "quantity", cand?.count ?? 0);
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
