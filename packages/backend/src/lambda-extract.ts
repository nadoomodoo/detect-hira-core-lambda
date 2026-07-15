import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { preprocessImage, applyRotation } from "./preprocess.js";
import { detectHiraCodes, detectRotation, shouldApplyRotation } from "./ocr.js";
import { lookupDrug, lookupManufacturer } from "./master.js";
import { extractImageBuffer, warmMaster } from "./lambda.js";

/**
 * AWS Lambda 핸들러 — 약가코드/제약사 추출 전용 (JSON only).
 *
 * annotate(이미지 합성) 없이, 이미지에서 검출된 약가코드와 제약사명만
 * JSON 으로 반환한다. 이미지를 복수 제약사에 공급하기 전에
 * "이 이미지에 어떤 제약사 약품이 들어있는지" 판별하는 용도.
 *
 * 입력 방식은 lambda.ts 와 동일 (S3 참조 / base64 JSON / binary body).
 * S3 출력, presigned URL, 폰트 등 이미지 합성 관련 의존성은 전혀 없다.
 *
 * 배포: 같은 번들에서 핸들러만 `lambda-extract.handler` 로 지정해
 * 별도 Lambda 함수(또는 별도 라우트)로 올린다.
 */

/** 검출 코드 1건의 조회 결과 (좌표 없음). */
interface ExtractedItem {
  code: string;
  manufacturer: string | null;
  drugName: string | null;
  found: boolean;
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const raw = await extractImageBuffer(event);
    if (!raw) {
      return json(400, {
        error: "이미지 입력이 필요합니다. { inputBucket, inputKey } 또는 { image: base64 }.",
      });
    }

    await warmMaster();

    // 1) 전처리 + 회전 판별 (OCR 정확도를 위해 회전 보정은 유지)
    const pre = await preprocessImage(raw);
    const rotation = await detectRotation(pre.buffer, pre.mimeType);

    let preOcr = pre;
    if (shouldApplyRotation(rotation)) {
      const rotated = await applyRotation(raw, rotation.rotation);
      preOcr = await preprocessImage(rotated.buffer);
    }

    // 2) OCR — 약가코드 검출
    const detections = await detectHiraCodes(preOcr.buffer, preOcr.mimeType);

    // 3) 코드 단위 dedupe (같은 코드가 등록코드/청구코드 두 컬럼에 반복 등장) 후 마스터 조회
    const codes = [...new Set(detections.map((d) => d.code))];
    const items: ExtractedItem[] = [];
    const codesByManufacturer = new Map<string, string[]>();
    for (const code of codes) {
      const record = await lookupDrug(code);
      const manufacturer = record?.manufacturer ?? null;
      items.push({
        code,
        manufacturer,
        drugName: record?.drugName ?? null,
        found: record !== null,
      });
      if (manufacturer) {
        const list = codesByManufacturer.get(manufacturer) ?? [];
        list.push(code);
        codesByManufacturer.set(manufacturer, list);
      }
    }

    // 제약사 마스터 조인 — 사업자번호(제약사 식별 키) 부착 (미매칭 시 null)
    const manufacturers = await Promise.all(
      [...codesByManufacturer].map(async ([name, mfrCodes]) => {
        const record = await lookupManufacturer(name);
        return {
          name,
          businessNumber: record?.businessNumber ?? null,
          codes: mfrCodes,
        };
      }),
    );

    // 인식됐지만 마스터에 없는 코드 → CloudWatch 로그 (마스터 갱신 필요 후보)
    const unknownCodes = items.filter((it) => !it.found).map((it) => it.code);
    if (unknownCodes.length > 0) {
      console.log(`마스터 미조회 코드 ${unknownCodes.length}건: ${unknownCodes.join(", ")}`);
    }

    return json(200, {
      manufacturers,
      uniqueManufacturers: [...codesByManufacturer.keys()],
      multiManufacturer: codesByManufacturer.size >= 2,
      items,
      detectedCodes: codes.length,
      unknownCodes,
      rotation: shouldApplyRotation(rotation) ? rotation.rotation : 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(500, { error: msg });
  }
};

/** JSON 응답 헬퍼. */
function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}
