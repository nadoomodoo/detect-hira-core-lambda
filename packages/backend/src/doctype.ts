import { generateJson, parseJsonLoose } from "./gemini.js";
import type { StageCost } from "./extract.js";

/**
 * 문서 유형 분류 — 표 추출이 실패했을 때만 호출(비-약품문서 triage).
 * 대량 업로드에 사업자등록증·영수증 등이 섞여 있을 때 "약품표 아님"을 명확히 라벨링해
 * 사용자가 걸러내거나 재촬영을 요청할 수 있게 한다. 저비용(단발 분류) 호출.
 */
export type DocumentType =
  | "drug_table" // 약품 거래/처방 표
  | "business_registration" // 사업자등록증
  | "prescription" // 처방전(표 형식 아님)
  | "receipt" // 영수증/계산서
  | "other" // 기타 문서
  | "unknown"; // 판별 실패

const SCHEMA = {
  type: "OBJECT",
  properties: {
    doc_type: {
      type: "STRING",
      enum: ["drug_table", "business_registration", "prescription", "receipt", "other"],
    },
  },
  required: ["doc_type"],
} as const;

const PROMPT = `이 이미지가 어떤 문서인지 한 가지로 분류하세요.
- drug_table: 약품(의약품) 거래/처방 내역이 표로 정리된 문서(약품코드·수량·금액 등)
- business_registration: 사업자등록증
- prescription: 처방전이지만 표 형식이 아님
- receipt: 영수증/계산서
- other: 위에 해당 없음
JSON {"doc_type": "..."} 만 반환.`;

/** 문서 유형 분류. 실패 시 unknown. costs 에 doctype 단계 원가 추가. */
export async function classifyDocument(
  imageBuffer: Buffer,
  mimeType: string,
  costs?: StageCost[],
): Promise<DocumentType> {
  try {
    const gen = await generateJson({ imageBuffer, mimeType, prompt: PROMPT, responseSchema: SCHEMA });
    if (costs) {
      costs.push({
        stage: "doctype",
        model: gen.model,
        calls: gen.usage.calls,
        tokensIn: gen.usage.tokensIn,
        tokensOut: gen.usage.tokensOut,
        costUsd: gen.costUsd,
        costKrw: gen.costKrw,
        latencyMs: gen.usage.latencyMs,
      });
    }
    const parsed = parseJsonLoose<{ doc_type?: string }>(gen.text);
    const t = parsed?.doc_type;
    if (t === "drug_table" || t === "business_registration" || t === "prescription" || t === "receipt" || t === "other") {
      return t;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
