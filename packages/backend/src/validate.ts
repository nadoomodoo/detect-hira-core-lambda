import type { MappedRow } from "./mapping.js";
import { lookupDrug, matchDrugPrice } from "./master.js";

/**
 * 항목별 검증 — 산술 교차검증 + 마스터 단가 대조 + 신호등.
 *
 * ⚠️ 원칙: 이건 OCR 이다. 이미지에서 읽은 값이 결과(정본)이며,
 *   마스터·산술은 오직 "검증"에만 쓴다. 읽지 않은 값을 역산/마스터로 채워
 *   결과값처럼 내보내지 않는다(값 수정·대체 금지). 마스터명/단가는 참조로만 노출.
 *
 * 검증 항목:
 *  - 산술: 수량×단가≈총금액, 수량×일수≈총처방량 (존재하는 OCR 값끼리만).
 *  - 마스터 단가(약가 상한금액) 대조 — SCD2 이력 반영(현재/과거/불일치).
 *  - confidence(합성) + 신호등(GREEN/YELLOW/RED) + 확인사유(reviewFlags).
 */

/** 약가코드 형식 분류. */
export type CodeType =
  | "hira" // 8~10자리 숫자 (HIRA 표준코드)
  | "internal" // 병원/약국 내부코드 (영문+숫자) — 마스터 대조 불가, 사용자 확인 필요
  | "none" // 코드 없음
  | "invalid"; // 형식 불명

export interface ValidatedRow extends MappedRow {
  codeValid: boolean;
  /** 코드 형식 분류. internal/invalid 는 사용자 확인 필요(HITL). */
  codeType: CodeType;
  mathValid: boolean;
  /** 마스터 단가 대조 결과. true=현재/과거 버전과 일치, false=불일치, null=대조 불가. */
  priceValid: boolean | null;
  /** 단가 변동 반영 상태(SCD2). current=현재가 / historical=과거가(단가 변동) / mismatch / none */
  priceStatus: "current" | "historical" | "mismatch" | "none";
  /** (참조·검증용) 마스터 현재 상한금액. OCR 값 대체 아님. */
  masterUnitPrice: number | null;
  /** (참조·검증용) 마스터 등록 제약사명. row.manufacturer(OCR)를 덮어쓰지 않음. */
  masterManufacturer: string | null;
  /** (참조·검증용) 마스터 등록 의약품명. */
  masterDrugName: string | null;
  confidence: number;
  trafficLight: "GREEN" | "YELLOW" | "RED";
  /** 사용자 확인 필요(HITL) — 내부코드/미조회/검증실패/단가변동 등. */
  needsReview: boolean;
  reviewFlags: string[];
  /** 약가코드 앵커 재크롭(2차 pass)으로 채워진 행인지 */
  recropPass?: boolean;
}

/** 코드 형식 분류. */
export function classifyCode(code: string | null | undefined): CodeType {
  const c = (code ?? "").trim();
  if (!c) return "none";
  if (/^\d{8,10}$/.test(c)) return "hira";
  // 병원 내부코드: 영문으로 시작하는 영숫자 3자 이상 (예: AMLOVAL516, CANDE16)
  if (/^[A-Za-z][A-Za-z0-9]{2,}$/.test(c)) return "internal";
  return "invalid";
}

/** 산술 허용오차: 상대 1% 또는 절대 1 중 큰 쪽. */
function approxEq(a: number, b: number): boolean {
  const tol = Math.max(1, Math.abs(b) * 0.01);
  return Math.abs(a - b) <= tol;
}

/** 산술 일관성 검사. 검사 가능한 관계가 하나라도 있으면 그 통과 여부를 반환. */
/**
 * 코드 유출 가드 — 숫자 필드가 약품코드(또는 그 절단/부분 자릿수)로 오인식된 경우 null 처리.
 * 9자리 표준코드는 그 행에서 가장 큰 숫자라 '총금액=가장 큰 값' 오인식으로 금액칸에 새기 쉽다
 * (예: 코드 653500300 → 총금액 6535003). 산술검증 전에 제거해 거짓 RED 대신 '확인 필요(YELLOW)'로.
 * row 를 제자리 변경하고, 제거한 필드에 대한 flag 문자열 배열을 반환한다.
 */
export function stripCodeLeak(row: MappedRow): string[] {
  const flags: string[] = [];
  const codeDigits = (row.drugCode ?? "").replace(/\D/g, "");
  if (codeDigits.length < 8) return flags; // 표준 9자리(±)만 대상 — 짧은 내부코드는 금액 오인 위험 없음
  const NUMF = ["quantity", "days", "prescribedQty", "unitPrice", "totalAmount"] as const;
  for (const f of NUMF) {
    const v = row[f];
    if (v == null) continue;
    const vd = String(v).replace(/\D/g, "");
    if (vd.length < 6) continue; // 짧은 값은 우연 일치 위험 — 코드 유출로 보지 않음
    const leak = vd === codeDigits || codeDigits.startsWith(vd) || vd.startsWith(codeDigits);
    if (leak) {
      row[f] = null;
      flags.push(`${f} 값(${v})이 약품코드(${row.drugCode})와 일치/유사 — 코드 오인식으로 제외, 재확인 필요`);
    }
  }
  return flags;
}

/**
 * 두 검산식을 독립 판정한다.
 *  - qty:    수량×일수 = 총처방량
 *  - amount: (총처방량 또는 수량)×단가 = 총금액
 * 한쪽 삼중항이 깨져도 다른 식 판정을 오염시키지 않도록 분리(재크롭 충돌 해소에서 필드 그룹별로 사용).
 */
export function checkMathParts(row: MappedRow): {
  qty: { checked: boolean; valid: boolean };
  amount: { checked: boolean; valid: boolean };
} {
  const { quantity, days, prescribedQty, unitPrice, totalAmount } = row;
  const qty = { checked: false, valid: true };
  if (quantity !== null && days !== null && prescribedQty !== null) {
    qty.checked = true;
    qty.valid = approxEq(quantity * days, prescribedQty);
  }
  const amount = { checked: false, valid: true };
  const qtyForAmount = prescribedQty ?? quantity;
  if (qtyForAmount !== null && unitPrice !== null && totalAmount !== null) {
    amount.checked = true;
    amount.valid = approxEq(qtyForAmount * unitPrice, totalAmount);
  }
  return { qty, amount };
}

export function checkMath(row: MappedRow): { checked: boolean; valid: boolean; flags: string[] } {
  const { qty, amount } = checkMathParts(row);
  const flags: string[] = [];
  if (qty.checked && !qty.valid) flags.push("수량×일수≠총처방량");
  if (amount.checked && !amount.valid) flags.push("수량×단가≠총금액");
  const checked = qty.checked || amount.checked;
  const valid = (!qty.checked || qty.valid) && (!amount.checked || amount.valid);
  return { checked, valid, flags };
}

const fmtD = (d: Date | null): string => (d ? new Date(d).toISOString().slice(0, 10) : "");

/**
 * 1행 검증. OCR 값은 그대로 두고, 마스터·산술은 검증 신호로만 사용한다.
 * 마스터명/단가는 참조 필드(masterManufacturer/masterUnitPrice)로만 노출 — 결과값 대체 없음.
 */
export async function validateRow(row: MappedRow): Promise<ValidatedRow> {
  const flags: string[] = [];

  // 1) 약가코드 형식 분류 + (HIRA 코드면) 마스터 존재 확인 (참조값 확보, 덮어쓰기 없음)
  const codeType = classifyCode(row.drugCode);
  let codeValid = false;
  let masterUnitPrice: number | null = null;
  let masterManufacturer: string | null = null;
  let masterDrugName: string | null = null;
  if (codeType === "hira") {
    const rec = await lookupDrug(row.drugCode!).catch(() => null);
    if (rec) {
      codeValid = true;
      masterUnitPrice = rec.unitPrice ?? null;
      masterManufacturer = rec.manufacturer ?? null;
      masterDrugName = rec.drugName ?? null;
    } else {
      // 미조회 9자리인데 끝이 0 여러 개 → 단축코드 0패딩(모델 환각) 의심.
      if (/0{3,}$/.test(row.drugCode!)) {
        flags.push("코드 끝 0 반복 — 단축코드 0패딩(환각) 의심, 원본 코드 확인 필요");
      } else {
        flags.push("약가코드 마스터 미조회 — 사용자 확인 필요");
      }
    }
  } else if (codeType === "internal") {
    flags.push("9자리 표준코드 아님(내부코드) — 사용자 확인 필요");
  } else if (codeType === "invalid") {
    flags.push("약가코드 형식 불명 — 사용자 확인 필요");
  } else {
    flags.push("약가코드 없음 — 사용자 확인 필요");
  }

  // 1.5) 코드 유출 가드: 숫자 필드가 약품코드로 오인식됐으면 제거(산술검증 전).
  flags.push(...stripCodeLeak(row));

  // 2) 산술 교차검증 (존재하는 OCR 값끼리만 — 역산/채움 없음)
  const math = checkMath(row);
  if (math.flags.length) flags.push(...math.flags);
  let mathChecked = math.checked;
  let mathValid = math.checked ? math.valid : false;
  let verifiedByMaster = false;
  // 단가가 이미지에 없을 때: 마스터 단가로 총금액 검증(값 대체 아님, 검증만).
  //  코드가 마스터에 있고 총금액·수량(또는 총처방량)이 있으면 마스터 단가로 곱해 총금액과 대조.
  //  통과하면 정상 처리, 마스터 단가로도 불일치면 확인 필요.
  const qtyForMaster = row.prescribedQty ?? row.quantity;
  if (
    !mathChecked &&
    row.unitPrice === null &&
    codeValid &&
    masterUnitPrice != null &&
    masterUnitPrice > 0 &&
    qtyForMaster != null &&
    row.totalAmount != null
  ) {
    mathChecked = true;
    mathValid = approxEq(qtyForMaster * masterUnitPrice, row.totalAmount);
    verifiedByMaster = mathValid;
    flags.push(
      mathValid
        ? `단가 미기재 — 마스터 단가(${masterUnitPrice}원)로 총금액 검증 통과`
        : `단가 미기재 + 마스터 단가(${masterUnitPrice}원)로도 총금액 불일치 — 확인 필요`,
    );
  } else if (!mathChecked) {
    flags.push("산술검증 불가(필드 부족)");
  }

  // 3) 마스터 단가 대조 (SCD2 이력 반영: current/historical/mismatch) — 검증 전용
  let priceValid: boolean | null = null;
  let priceStatus: ValidatedRow["priceStatus"] = "none";
  if (codeValid && row.unitPrice !== null) {
    const pm = await matchDrugPrice(row.drugCode!, row.unitPrice).catch(() => null);
    if (pm) {
      priceStatus = pm.status;
      if (pm.status === "current") {
        priceValid = true;
      } else if (pm.status === "historical") {
        priceValid = true; // 과거 버전과 일치 — 값은 맞지만 시점 확인 필요
        flags.push(
          `단가 변동: 과거 단가 ${pm.matchedPrice}원(${fmtD(pm.validFrom)}~${fmtD(pm.validTo)})와 일치` +
            (pm.currentPrice != null ? `, 현재가 ${pm.currentPrice}원` : "") +
            " — 처방/거래 시점 확인",
        );
      } else if (pm.status === "mismatch") {
        priceValid = false;
        flags.push(`단가 불일치: 추출 ${row.unitPrice}원, 현재/과거 어느 버전과도 불일치` + (pm.currentPrice != null ? `(현재가 ${pm.currentPrice}원)` : ""));
      }
    }
  }

  // 4) 합성 confidence (요소별 곱 — 약점 강하게 반영). 값 수정 아님, 신뢰도 산정만.
  let conf = 1.0;
  if (codeType === "hira" && !codeValid) conf *= 0.55;
  else if (codeType === "internal") conf *= 0.75;
  else if (codeType === "invalid" || codeType === "none") conf *= 0.5;
  if (row.reassigned) conf *= 0.85; // 컬럼 밀림 복구 개입 — 어느 컬럼을 읽었는지 불확실
  if (mathChecked && !mathValid) conf *= 0.5;
  if (!mathChecked) conf *= 0.9;
  if (priceStatus === "historical") conf *= 0.85; // 단가 변동 — 시점 확인 필요
  if (priceValid === false) conf *= 0.6;

  // 5) 신호등 — 심각도 재정의(값 중심):
  //  RED   : "값(숫자) 오류" — 산술검증됐는데 불일치(수량×단가≠총금액 등).
  //  YELLOW: "확인 필요하나 숫자는 정상" — 코드 비표준/미조회, 단가≠마스터(산술은 일치),
  //          단가 변동(historical), 컬럼 재식별, 산술검증 불가(마스터로도 확인 안 됨).
  //          약가코드가 이상해도 약품명·숫자가 정상이면 넘어갈 수 있게 하되 확인 표시.
  //  GREEN : 산술 통과(또는 마스터 단가로 총금액 검증 통과) + 표준코드 마스터 조회.
  const codeConcern = codeType !== "hira" || !codeValid;
  const numberError = mathChecked && !mathValid; // 산술검증됐는데 불일치 = 값 오류
  const mathUncheckedConcern = !mathChecked && !verifiedByMaster; // 마스터로도 검증 불가
  let trafficLight: ValidatedRow["trafficLight"];
  if (numberError) {
    trafficLight = "RED";
  } else if (
    codeConcern ||
    priceValid === false ||
    priceStatus === "historical" ||
    row.reassigned ||
    mathUncheckedConcern
  ) {
    trafficLight = "YELLOW";
  } else {
    trafficLight = "GREEN";
  }
  const needsReview = trafficLight !== "GREEN";

  return {
    ...row,
    codeValid,
    codeType,
    mathValid,
    priceValid,
    priceStatus,
    masterUnitPrice,
    masterManufacturer,
    masterDrugName,
    confidence: Number(conf.toFixed(3)),
    trafficLight,
    needsReview,
    reviewFlags: flags,
  };
}

/** 여러 행 검증 (병렬). */
export async function validateRows(rows: MappedRow[]): Promise<ValidatedRow[]> {
  return Promise.all(rows.map((r) => validateRow(r)));
}

/** 신호등 집계. */
export function tallyTrafficLights(rows: ValidatedRow[]): {
  green: number;
  yellow: number;
  red: number;
} {
  let green = 0;
  let yellow = 0;
  let red = 0;
  for (const r of rows) {
    if (r.trafficLight === "GREEN") green++;
    else if (r.trafficLight === "YELLOW") yellow++;
    else red++;
  }
  return { green, yellow, red };
}
