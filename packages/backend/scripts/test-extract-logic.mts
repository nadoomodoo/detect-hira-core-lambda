/**
 * extract 순수로직 단위 테스트 (DB 불필요).
 *   npx tsx scripts/test-extract-logic.mts
 * mapping(컬럼 매핑·밀림 복구·결합컬럼·숫자파싱) + validate.classifyCode 검증.
 */
import assert from "node:assert/strict";
import { mapHeader, parseNumber, mapRow, mapTable, isSummaryRow } from "../src/mapping.js";
import { classifyCode, stripCodeLeak, checkMathParts } from "../src/validate.js";
import type { MappedRow } from "../src/mapping.js";

const mkRow = (p: Partial<MappedRow>): MappedRow => ({
  rowIndex: 0, drugCode: null, drugName: null, manufacturer: null,
  quantity: null, days: null, prescribedQty: null, unitPrice: null, totalAmount: null,
  raw: {}, reassigned: false, ...p,
});

let pass = 0;
function t(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}

console.log("mapHeader:");
t("표준 헤더 매핑", () => {
  assert.equal(mapHeader("약품코드"), "drugCode");
  assert.equal(mapHeader("청구코드"), "drugCode");
  assert.equal(mapHeader("총 처방량"), "prescribedQty");
  assert.equal(mapHeader("단가"), "unitPrice");
  assert.equal(mapHeader("금액"), "totalAmount");
  assert.equal(mapHeader("급액"), "totalAmount"); // OCR 오독 변형
  assert.equal(mapHeader("수량"), "quantity");
  assert.equal(mapHeader("일수"), "days");
});
t("공백/괄호 정규화", () => {
  assert.equal(mapHeader(" 약품 코드 "), "drugCode");
  assert.equal(mapHeader("금액(원)"), "totalAmount");
});
t("미매핑은 null", () => assert.equal(mapHeader("비고"), null));

console.log("parseNumber:");
t("콤마/원 제거", () => {
  assert.equal(parseNumber("1,659,150"), 1659150);
  assert.equal(parseNumber("335"), 335);
  assert.equal(parseNumber("0.5"), 0.5);
  assert.equal(parseNumber("1,200원"), 1200);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("-"), null);
});
t("금액(money): 점=천단위, 소수2자리는 소수점", () => {
  assert.equal(parseNumber("417.410", "money"), 417410); // 점 3자리 = 천단위
  assert.equal(parseNumber("1.659.150", "money"), 1659150); // 점 여러개 = 천단위
  assert.equal(parseNumber("1,659,150", "money"), 1659150);
  assert.equal(parseNumber("3,292.65", "money"), 3292.65); // 마지막 . = 소수점
  assert.equal(parseNumber("150.000", "money"), 150000);
  assert.equal(parseNumber("790.258", "money"), 790258);
});
t("수량(count): 점 3자리=천단위, 1~2자리=소수점", () => {
  assert.equal(parseNumber("593.5", "count"), 593.5); // 1자리 = 소수
  assert.equal(parseNumber("40.65", "count"), 40.65); // 2자리 = 소수
  assert.equal(parseNumber("1.168", "count"), 1168); // 3자리 = 천단위(1168)
  assert.equal(parseNumber("5,836.5", "count"), 5836.5);
  assert.equal(parseNumber("1,000", "count"), 1000);
  assert.equal(parseNumber("120", "count"), 120);
});

console.log("mapRow — 정상 매핑:");
t("헤더 기반 정상 행", () => {
  const cols = ["약품코드", "약품명", "수량", "단가", "금액"];
  const row = mapRow(cols, ["647300350", "모사피아정", "100", "335", "33500"], 0);
  assert.equal(row.drugCode, "647300350");
  assert.equal(row.drugName, "모사피아정");
  assert.equal(row.quantity, 100);
  assert.equal(row.unitPrice, 335);
  assert.equal(row.totalAmount, 33500);
  assert.equal(row.reassigned, false);
});

console.log("mapRow — 결합 컬럼:");
t("청구코드 명칭 분리", () => {
  const cols = ["청구코드 명칭", "수량", "금액"];
  const row = mapRow(cols, ["647300350 모사피아정", "10", "3350"], 0);
  assert.equal(row.drugCode, "647300350");
  assert.equal(row.drugName, "모사피아정");
});

console.log("mapRow — 이중 코드 컬럼(처방코드+청구코드):");
t("표준 약가코드(청구코드) 우선 — 처방코드가 먼저 와도", () => {
  // 약품 통계 및 환자현황: 처방코드(내부) + 청구코드(약가코드) 둘 다 존재
  const cols = ["처방코드", "청구코드", "한글명칭", "단가", "총투여량", "총금액"];
  const row = mapRow(cols, ["acc15", "693903510", "액토스정15밀리그램", "623", "30", "18690"], 0);
  assert.equal(row.drugCode, "693903510"); // 내부코드(acc15) 아니라 표준 약가코드
  assert.equal(row.drugName, "액토스정15밀리그램");
  assert.equal(row.unitPrice, 623);
  assert.equal(row.totalAmount, 18690);
});
t("청구코드가 먼저 와도 표준코드 유지(순서 무관)", () => {
  const cols = ["청구코드", "처방코드", "약품명", "금액"];
  const row = mapRow(cols, ["693903510", "acc15", "액토스정", "18690"], 0);
  assert.equal(row.drugCode, "693903510");
});
t("표준코드가 약품명 칸으로 밀린 경우 승격", () => {
  // VLM 정렬 오류: drugCode=내부코드, 약가코드가 약품명 셀로 들어감
  const cols = ["약품코드", "약품명", "단가", "금액"];
  const row = mapRow(cols, ["acc15", "693903510", "623", "18690"], 0);
  assert.equal(row.drugCode, "693903510"); // 약품명 셀의 순수 9자리를 코드로 승격
  assert.equal(row.reassigned, true);
});
t("비율 컬럼이 수량/총처방량을 덮어쓰지 않음", () => {
  // 원외처방 통계: 처방횟수비율/처방량비율(%) 이 처방횟수/처방량 부분매칭으로 수량칸을 오염시키던 버그
  const cols = ["코드", "약명", "단가", "총 처방횟수", "총 처방량", "처방횟수비율", "처방량비율"];
  const row = mapRow(cols, ["698500100", "로닌정", "125", "118", "669", "17.1", "10"], 0);
  assert.equal(row.quantity, 118); // 처방횟수비율(17.1)이 아니라 총 처방횟수
  assert.equal(row.prescribedQty, 669); // 처방량비율(10)이 아니라 총 처방량
});
t("약품명 앞에 붙은 표준코드 분리·승격", () => {
  // VLM: drugCode=내부코드(7자리·형식불명), 표준 9자리가 약품명 앞에 접두
  const cols = ["약품코드", "약품명", "단가"];
  const row = mapRow(cols, ["6519024", "651902140 토파메이트정25밀리그램(토피라메이트)_(25mg/1정)", "3"], 0);
  assert.equal(row.drugCode, "651902140"); // 이름 접두 코드를 승격
  assert.equal(row.drugName, "토파메이트정25밀리그램(토피라메이트)_(25mg/1정)"); // 코드 제거된 이름
  assert.equal(row.reassigned, true);
});
t("약품명 용량 숫자는 코드로 오인하지 않음", () => {
  // 8~10자리 코드가 없으면 이름을 건드리지 않음(25, 12.5 등 짧은 숫자 무시)
  const cols = ["약품코드", "약품명", "단가"];
  const row = mapRow(cols, ["acc15", "카르디날정12.5mg(카르베딜롤)", "3"], 0);
  assert.equal(row.drugName, "카르디날정12.5mg(카르베딜롤)");
});
t("8자리 금액을 코드로 오인하지 않음", () => {
  // 내부코드 + 8자리 총금액(10,000,000) — 금액 셀은 코드 승격 대상에서 제외
  const cols = ["약품코드", "약품명", "단가", "금액"];
  const row = mapRow(cols, ["acc15", "액토스정", "50000", "10000000"], 0);
  assert.equal(row.drugCode, "acc15"); // 금액(10000000)을 코드로 승격하지 않음
  assert.equal(row.totalAmount, 10000000);
});

t("약품 통계 및 환자현황 전체 헤더 정렬", () => {
  const cols = ["처방코드", "청구코드", "한글명칭", "제약사", "내외", "단가", "단가적용", "건수", "총투여량", "총투여횟수", "총금액", "약품분류"];
  const row = mapRow(cols, ["acc15", "693903510", "액토스정15밀리그램", "셀트리온제약", "원외", "623", "급여", "1", "30", "1", "18690", "396"], 0);
  assert.equal(row.drugCode, "693903510"); // 청구코드=약가코드
  assert.equal(row.drugName, "액토스정15밀리그램");
  assert.equal(row.manufacturer, "셀트리온제약");
  assert.equal(row.unitPrice, 623); // 단가적용(급여)에 오염 안 됨
  assert.equal(row.quantity, 1); // 건수
  assert.equal(row.prescribedQty, 30); // 총투여량 (총투여횟수에 덮이지 않음)
  assert.equal(row.totalAmount, 18690); // 약품분류(396)를 금액으로 오인 안 함
});

console.log("mapRow — 컬럼 밀림 복구:");
t("미매핑 숫자 값-패턴 재식별", () => {
  // 헤더가 인식 안 되는 컬럼(col1,col2,col3)에 단가/금액/수량이 들어옴
  const cols = ["약품코드", "비고1", "비고2", "비고3"];
  const row = mapRow(cols, ["647300350", "675", "1659150", "10"], 0);
  assert.equal(row.drugCode, "647300350");
  assert.equal(row.totalAmount, 1659150); // 가장 큰 값(≥10000)
  assert.equal(row.unitPrice, 675); // 100~50000
  assert.equal(row.quantity, 10); // 정수 1~9999
  assert.equal(row.reassigned, true);
});
t("미매핑 숫자 money 범위 재식별(단가/금액)", () => {
  const cols = ["약품코드", "x", "y"];
  const row = mapRow(cols, ["647300350", "335", "125000"], 0);
  assert.equal(row.unitPrice, 335); // 100~50,000 → 단가
  assert.equal(row.totalAmount, 125000); // ≥10,000 → 총금액
});

console.log("mapTable — object rows:");
t("헤더 키 객체 행", () => {
  const cols = ["약품코드", "수량"];
  const rows = mapTable(cols, [{ 약품코드: "647300350", 수량: "5" }]);
  assert.equal(rows[0].drugCode, "647300350");
  assert.equal(rows[0].quantity, 5);
});

console.log("isSummaryRow:");
t("합계 키워드 행 = 요약", () => {
  const cols = ["명칭", "총금액"];
  const row = mapRow(cols, ["합 계", "1197300"], 9);
  assert.equal(isSummaryRow(row), true);
});
t("코드 있는 행은 요약 아님", () => {
  const cols = ["청구코드", "명칭", "총금액"];
  const row = mapRow(cols, ["658106350", "합계정", "734760"], 0);
  assert.equal(isSummaryRow(row), false);
});

console.log("classifyCode:");
t("HIRA 8~10자리 숫자", () => {
  assert.equal(classifyCode("647300350"), "hira");
  assert.equal(classifyCode("12345678"), "hira");
  assert.equal(classifyCode("1234567890"), "hira");
});
t("내부코드(영숫자) = internal", () => {
  assert.equal(classifyCode("AMLOVAL516"), "internal");
  assert.equal(classifyCode("CANDE16"), "internal");
});
t("빈값/형식불명", () => {
  assert.equal(classifyCode(""), "none");
  assert.equal(classifyCode(null), "none");
  assert.equal(classifyCode("12-34"), "invalid");
  assert.equal(classifyCode("1234567"), "invalid"); // 7자리(짧음)
});

console.log("stripCodeLeak — 코드 유출 가드:");
t("총금액이 코드 절단값이면 제거", () => {
  // 코드 653500300 → 총금액 6535003(7자리 절단)
  const row = mkRow({ drugCode: "653500300", quantity: 5, unitPrice: 634, totalAmount: 6535003 });
  const flags = stripCodeLeak(row);
  assert.equal(row.totalAmount, null);
  assert.equal(row.quantity, 5); // 정상값은 유지
  assert.equal(row.unitPrice, 634);
  assert.equal(flags.length, 1);
});
t("단가·수량이 코드 전체와 일치하면 제거", () => {
  const row = mkRow({ drugCode: "648601820", unitPrice: 6486018, quantity: 648601820, totalAmount: 59492 });
  stripCodeLeak(row);
  assert.equal(row.unitPrice, null);
  assert.equal(row.quantity, null);
  assert.equal(row.totalAmount, 59492); // 정상 총금액 유지
});
t("코드 무관 정상값은 건드리지 않음", () => {
  const row = mkRow({ drugCode: "653500300", quantity: 5, days: 41, prescribedQty: 205, unitPrice: 634, totalAmount: 129970 });
  const flags = stripCodeLeak(row);
  assert.equal(flags.length, 0);
  assert.equal(row.totalAmount, 129970);
});
t("짧은 내부코드는 대상 아님", () => {
  const row = mkRow({ drugCode: "A123", totalAmount: 123 });
  assert.equal(stripCodeLeak(row).length, 0);
  assert.equal(row.totalAmount, 123);
});

console.log("checkMathParts — 방정식 분리 판정:");
t("금액식/수량식 독립 판정", () => {
  // 수량 삼중항은 깨졌지만 금액식(총처방량×단가=총금액)은 통과해야 함
  const row = mkRow({ quantity: 634, days: 5, prescribedQty: 4.5, unitPrice: 634, totalAmount: 2853 });
  const { qty, amount } = checkMathParts(row);
  assert.equal(qty.checked, true);
  assert.equal(qty.valid, false); // 634×5 ≠ 4.5
  assert.equal(amount.checked, true);
  assert.equal(amount.valid, true); // 4.5×634 ≈ 2853
});

console.log(`\n통과 ${pass}건${process.exitCode ? " · 실패 있음" : " · 전체 통과"}`);
