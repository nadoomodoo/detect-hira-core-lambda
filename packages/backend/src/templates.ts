import { prisma } from "@platform/db";

/**
 * 프롬프트 템플릿 해석 — DB(PromptTemplate) 기반 이력관리 + templateId 적용.
 *
 * 우선순위: templateId 지정 → 해당 버전, 없으면 key 의 active=true 최신본,
 * DB 에 아무것도 없으면 코드 내 DEFAULT 로 폴백(초기 부트스트랩/시딩 전에도 동작).
 *
 * 요청/결과에는 적용된 template(id/key/version) 스냅샷을 저장해 재현성을 보장한다.
 */

export const EDI_TEMPLATE_KEY = "edi-extract";

/** 기본 추출 프롬프트 (edi-vision-extractor EXTRACT_PROMPT + nadoo-ocr 컬럼 지침 통합). */
export const DEFAULT_EXTRACT_PROMPT = `이 이미지는 병의원/약국 EDI(전자문서) 또는 처방/거래 화면(혹은 그 사진)입니다.
표에 약품별 거래/처방 정보가 담겨 있습니다. 표를 찾아 아래 JSON 으로 정확히 추출하세요.

출력 형식:
{
  "found_drug_table": true/false,   // 약품 표가 있으면 true
  "image_quality": {                // 이미지 자체의 이상 여부 판단(추출 신뢰도·재촬영 판단용)
    "readable": true/false,         // 표의 숫자를 신뢰성 있게 읽을 수 있으면 true, 흐리거나 잘리거나 어두워 어려우면 false
    "issues": ["blur", ...],        // 해당하는 문제만: blur(흐림) dark(어두움) glare(빛반사) skew(기울어짐) rotated(회전) partial(표 일부 잘림) low_res(저해상도) noise(노이즈). 없으면 []
    "note": "한 줄 요약(선택)"
  },
  "columns": ["헤더1", "헤더2", ...],  // 표의 헤더를 왼쪽→오른쪽 순서 그대로
  "rows": [ ["셀1", "셀2", ...], ... ] // 각 행의 셀을 columns 와 같은 개수·순서로
}

규칙:
- image_quality 는 항상 채운다. 표가 있어도 흐림/잘림 등으로 값 신뢰가 낮으면 readable=false 로 표시.
- columns 는 이미지에 보이는 헤더 텍스트를 그대로(번역/정규화 금지) 넣는다.
- 각 row 의 셀 개수는 columns 개수와 반드시 같게 맞춘다. 빈 칸은 "" 로 채운다.
- [전체 추출] 표의 **모든 행을 빠짐없이** 넣는다. 여러 제약사/여러 소구간/여러 페이지가 한 화면에 있으면 **전부** 포함하고 중간을 생략하지 않는다. 행이 많아도 끝까지 나열한다.
- [약품명 필수] 각 행의 **약품명(명칭)은 반드시** 채운다. 약품코드가 없거나 병원 자체코드라도 약품명으로 식별해야 하므로 명칭을 비우지 말 것.
- [코드 원문] 약품코드는 **보이는 그대로**. 병원 자체 단축코드(영문+숫자 등)면 그대로 넣고, **9자리로 임의로 채우거나 0을 붙여 만들지 마라**. 안 보이면 "".
- [숫자 원문·자릿수 보존] 숫자(수량/일수/단가/금액/총처방량 등)는 이미지에 보이는 값 그대로. **콤마 포함 전체 자릿수를 그대로** 넣고 자릿수를 줄이거나 반올림·절단하지 마라(예: 790,258 을 79 로 줄이지 말 것). 소수점(.5 등)도 보존. 재계산/추정 금지.
- [합계 제외] 합계·소계·총계·누계·"약품건수" 같은 **집계 행은 rows 에 넣지 않는다**(약품 항목 아님).
- [중복 금지] **같은 행을 반복 생성하지 마라**. 각 약품 행은 이미지에 보이는 만큼만.
- 컬럼이 병합("청구코드 명칭" 등)돼 코드와 이름이 한 셀에 있으면 그 셀에 그대로 둔다(임의 분리 금지).
- 표가 기울어졌거나 셀 경계가 흐려도, 각 값이 실제로 속한 행을 정확히 지켜라(행이 밀리지 않게).
- 순번/No/연번 같은 행번호는 값(수량 등)이 아니다. 혼동하지 마라.
- 이미지에 실제로 보이는 값만 반환하고, 없는 값을 지어내지 마라.
- 약품 표가 없으면 {"found_drug_table": false, "columns": [], "rows": []} 만 반환.
- JSON 만 반환한다.`;

/** 기본 추출 응답 스키마 (Gemini responseSchema, JSON 직렬화 가능한 형태). */
export const DEFAULT_EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    found_drug_table: { type: "BOOLEAN" },
    image_quality: {
      type: "OBJECT",
      properties: {
        readable: { type: "BOOLEAN" },
        issues: { type: "ARRAY", items: { type: "STRING" } },
        note: { type: "STRING" },
      },
    },
    columns: { type: "ARRAY", items: { type: "STRING" } },
    rows: {
      type: "ARRAY",
      items: { type: "ARRAY", items: { type: "STRING" } },
    },
  },
  required: ["found_drug_table", "columns", "rows"],
} as const;

/** 약가코드 앵커 재크롭(§8) 단일 행 재추출 프롬프트. */
export const DEFAULT_RECROP_PROMPT = `이 이미지는 EDI 표에서 약품코드 {CODE} 가 있는 한 행(가로 밴드)만 잘라낸 것입니다.
이 행의 숫자 항목만 JSON 으로 추출하세요.

출력: {"drug_code":"{CODE}","quantity":숫자|null,"days":숫자|null,"prescribed_qty":숫자|null,"unit_price":숫자|null,"total_amount":숫자|null}

규칙:
- 보이는 값만 넣고 없으면 null. 재계산/추정 금지.
- [자릿수 보존] 숫자는 콤마 포함 **전체 자릿수 그대로** 읽는다. 큰 금액을 짧게 줄이거나 절단하지 말 것(예: 790,258 을 79 로 읽지 말 것). 소수점(.5 등) 보존.
- 수량=1회/총 사용 개수(처방횟수·환자수 포함), 일수=투약일수, 총처방량=총사용량/총투여량/총소모량, 단가=1개 가격, 총금액=총액(가장 큰 금액).
- JSON 만 반환.`;

export const DEFAULT_RECROP_SCHEMA = {
  type: "OBJECT",
  properties: {
    drug_code: { type: "STRING" },
    quantity: { type: "NUMBER", nullable: true },
    days: { type: "NUMBER", nullable: true },
    prescribed_qty: { type: "NUMBER", nullable: true },
    unit_price: { type: "NUMBER", nullable: true },
    total_amount: { type: "NUMBER", nullable: true },
  },
  required: ["drug_code"],
} as const;

export interface ResolvedTemplate {
  id: string | null;
  key: string;
  version: number | null;
  body: string;
  responseSchema: unknown;
  model: string | null;
  params: Record<string, unknown> | null;
}

/** 코드 내 기본 템플릿(DB 미시딩 시 폴백). */
function defaultTemplate(): ResolvedTemplate {
  return {
    id: null,
    key: EDI_TEMPLATE_KEY,
    version: null,
    body: DEFAULT_EXTRACT_PROMPT,
    responseSchema: DEFAULT_EXTRACT_SCHEMA,
    model: null,
    params: null,
  };
}

/**
 * 템플릿 해석. templateId 우선, 없으면 key 의 active 최신본, 그다음 코드 기본값.
 */
export async function resolveTemplate(opts?: {
  templateId?: string | null;
  key?: string;
}): Promise<ResolvedTemplate> {
  const key = opts?.key ?? EDI_TEMPLATE_KEY;
  try {
    if (opts?.templateId) {
      const t = await prisma.promptTemplate.findUnique({ where: { id: opts.templateId } });
      if (t) return toResolved(t);
    }
    const active = await prisma.promptTemplate.findFirst({
      where: { key, active: true },
      orderBy: { version: "desc" },
    });
    if (active) return toResolved(active);
  } catch (e) {
    console.warn("template_resolve_failed, using default:", e instanceof Error ? e.message : e);
  }
  return defaultTemplate();
}

function toResolved(t: {
  id: string;
  key: string;
  version: number;
  body: string;
  responseSchema: unknown;
  model: string | null;
  params: unknown;
}): ResolvedTemplate {
  return {
    id: t.id,
    key: t.key,
    version: t.version,
    body: t.body,
    responseSchema: t.responseSchema,
    model: t.model,
    params: (t.params as Record<string, unknown> | null) ?? null,
  };
}
