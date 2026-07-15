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
            "401": { description: "invalid_key" },
            "402": { description: "insufficient_credit" },
            "404": { description: "product_not_found" },
            "422": { description: "bad_image" },
            "502": { description: "processor_error (자동 환불)" },
          },
        },
      },
    },
    components: {
      securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
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
      },
    },
  };
  return NextResponse.json(spec);
}
