/**
 * extract 순수로직 단위 테스트 (DB 불필요).
 *   npx tsx scripts/test-extract-logic.mts
 * mapping(컬럼 매핑·밀림 복구·결합컬럼·숫자파싱) + validate.classifyCode 검증.
 */
import assert from "node:assert/strict";
import { mapHeader, parseNumber, mapRow, mapTable, isSummaryRow } from "../src/mapping.js";
import { classifyCode } from "../src/validate.js";

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

console.log(`\n통과 ${pass}건${process.exitCode ? " · 실패 있음" : " · 전체 통과"}`);
