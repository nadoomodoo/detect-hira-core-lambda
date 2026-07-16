import { NextResponse } from "next/server";
import { prisma } from "@platform/db";
import { API_BASE } from "@/lib/config";

export const dynamic = "force-dynamic";

/** API별 OpenAPI 3 스펙 (Swagger/Postman 임포트용). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await prisma.product.findUnique({ where: { slug } }).catch(() => null);
  if (!p) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

  const spec = {
    openapi: "3.0.3",
    info: { title: `${p.name} API`, version: "1.0.0", description: p.description ?? undefined },
    servers: [{ url: API_BASE }],
    security: [{ ApiKeyAuth: [] }],
    paths: {
      [`/api/v1/${p.slug}/detect`]: {
        post: {
          summary: p.name,
          description: `성공 호출당 ${p.priceKrw}원 (계정당 무료 ${p.freeQuota}회 후 과금).`,
          parameters: [
            { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" }, description: "재시도 시 이중 과금 방지" },
          ],
          requestBody: {
            required: true,
            content: {
              "image/jpeg": { schema: { type: "string", format: "binary" } },
              "image/png": { schema: { type: "string", format: "binary" } },
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    image: { type: "string", description: "base64 이미지" },
                    imageUrl: { type: "string", format: "uri", description: "이미지 https URL" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "검출 결과",
              content: { "application/json": { schema: { $ref: "#/components/schemas/DetectResult" } } },
            },
            "401": {
              description: "API 키 누락/무효 (invalid_key)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "invalid_key" } } },
            },
            "402": {
              description: "무료 소진 + 잔액 부족 (insufficient_credit)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/InsufficientCreditError" }, example: { error: "insufficient_credit", freeUsed: 10, freeQuota: 10, applyUrl: "https://market.nadoo.ai/dashboard/apply" } } },
            },
            "404": {
              description: "없는/종료된 API (product_not_found / not_found)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "product_not_found" } } },
            },
            "413": {
              description: "요청 본문 크기 초과 (기본 25MB)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "payload_too_large", maxBytes: 26214400 } } },
            },
            "500": {
              description: "내부 오류",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "internal_error" } } },
            },
            "502": {
              description: "처리 실패 — 과금분 자동 환불 (processor_error)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ProcessorError" }, example: { error: "processor_error", refunded: true } } },
            },
          },
        },
      },
      [`/api/v1/${p.slug}/detect-batch`]: {
        post: {
          summary: `${p.name} — 벌크(다중 이미지)`,
          description: `여러 이미지를 한 번에 처리(최대 50건, 제한 동시성). 항목별 독립 과금(성공 ${p.priceKrw}원, 실패 자동 환불). 대량은 imageUrls 권장.`,
          parameters: [
            { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" }, description: "배치 재시도 이중 과금 방지(항목별 `키:인덱스`)" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    images: { type: "array", items: { type: "string" }, description: "base64 이미지 배열" },
                    imageUrls: { type: "array", items: { type: "string", format: "uri" }, description: "이미지 https URL 배열" },
                  },
                },
                example: { imageUrls: ["https://.../a.jpg", "https://.../b.jpg"] },
              },
            },
          },
          responses: {
            "200": {
              description: "배치 결과 (부분 성공 포함)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/BatchResult" } } },
            },
            "400": {
              description: "빈 배치/잘못된 JSON/건수 초과",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "too_many_items", maxItems: 50 } } },
            },
            "401": { description: "invalid_key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "404": { description: "product_not_found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
    },
    components: {
      securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
        BatchResult: {
          type: "object",
          properties: {
            batch: { type: "boolean", enum: [true] },
            count: { type: "integer", description: "요청 항목 수" },
            ok: { type: "integer", description: "성공 건수" },
            failed: { type: "integer", description: "실패 건수" },
            totalCostKrw: { type: "integer", description: "이번 배치 총 과금액(원)" },
            balanceKrw: { type: "integer", description: "처리 후 잔액(원)" },
            results: {
              type: "array",
              description: "항목별 결과 (요청 순서, index 포함)",
              items: {
                allOf: [
                  { type: "object", properties: { index: { type: "integer" }, status: { type: "integer", description: "항목 HTTP 상태(200/402/502)" } } },
                  { $ref: "#/components/schemas/DetectResult" },
                ],
              },
            },
          },
        },
        DetectResult: {
          type: "object",
          properties: {
            requestId: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string", description: "9자리 약가코드" },
                  manufacturer: { type: "string", nullable: true },
                  drugName: { type: "string", nullable: true },
                  found: { type: "boolean" },
                },
              },
            },
            uniqueManufacturers: { type: "array", items: { type: "string" } },
            tagged: { type: "boolean" },
            rotation: { type: "integer", enum: [0, 90, 180, 270] },
            unknownCodes: { type: "array", items: { type: "string" } },
            output: {
              type: "object",
              properties: {
                mode: { type: "string", enum: ["gcs", "inline"] },
                url: { type: "string", format: "uri" },
                base64: { type: "string" },
                contentType: { type: "string" },
              },
            },
            cost: { type: "object", properties: { krw: { type: "integer" }, free: { type: "boolean" } } },
            balanceKrw: { type: "integer" },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string", description: "오류 코드" } },
        },
        InsufficientCreditError: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string", enum: ["insufficient_credit"] },
            freeUsed: { type: "integer", description: "사용한 무료 횟수" },
            freeQuota: { type: "integer", description: "계정당 무료 제공 횟수" },
            applyUrl: { type: "string", format: "uri", description: "사용 신청 폼 URL" },
          },
        },
        ProcessorError: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string", enum: ["processor_error"] },
            refunded: { type: "boolean", description: "과금분 자동 환불 여부" },
          },
        },
      },
    },
  };
  return NextResponse.json(spec);
}
