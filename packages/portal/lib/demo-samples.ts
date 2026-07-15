// 데모 샘플 갤러리 매니페스트 (하이브리드 데모의 "샘플" 파트)
// 각 샘플은 사전계산 결과를 사용하므로 즉시·무료로 렌더링됩니다 (게이트웨이 호출/일일 한도 미소모).
//
// ── 나중에 실제 샘플로 교체하는 법 ────────────────────────────────
// 1) public/demo-samples/ 에 PII-안전 이미지 2장(원본/결과) 추가
// 2) 아래 항목의 before/after 경로를 그 파일로 변경
// 3) items·uniqueManufacturers·tagged 를 실제 결과로 갱신
//    (실제 응답을 얻으려면: 해당 이미지를 /api/demo/detect 로 한 번 POST 후 응답 복붙)
// 지금은 전부 더미 플레이스홀더입니다.

export interface SampleItem {
  code: string;
  manufacturer: string | null;
  drugName: string | null;
  found: boolean;
}

export interface DemoSample {
  id: string;
  label: string; // 칩에 표시되는 짧은 이름
  before: string; // 원본 이미지 경로 (public 기준)
  after: string; // 검출 결과 이미지 경로 (public 기준)
  tagged: boolean;
  items: SampleItem[];
  uniqueManufacturers: string[];
  placeholder?: boolean; // true면 "더미" 배지 표시
}

const BEFORE = "/demo-samples/placeholder-before.svg";
const AFTER = "/demo-samples/placeholder-after.svg";

export const DEMO_SAMPLES: DemoSample[] = [
  {
    id: "sample-single",
    label: "단일 제약사",
    before: BEFORE,
    after: AFTER,
    tagged: false,
    placeholder: true,
    items: [
      { code: "658107190", manufacturer: "한풍제약 주식회사", drugName: "아제나정(아젤라스틴염산염)", found: true },
      { code: "642901360", manufacturer: "한풍제약 주식회사", drugName: "○○정", found: true },
      { code: "647300230", manufacturer: "한풍제약 주식회사", drugName: "△△캡슐", found: true },
    ],
    uniqueManufacturers: ["한풍제약 주식회사"],
  },
  {
    id: "sample-multi",
    label: "복수 제약사 (태깅)",
    before: BEFORE,
    after: AFTER,
    tagged: true,
    placeholder: true,
    items: [
      { code: "658107190", manufacturer: "한풍제약 주식회사", drugName: "아제나정", found: true },
      { code: "699800120", manufacturer: "대웅제약", drugName: "□□정", found: true },
      { code: "645500080", manufacturer: null, drugName: null, found: false },
    ],
    uniqueManufacturers: ["한풍제약 주식회사", "대웅제약"],
  },
];
