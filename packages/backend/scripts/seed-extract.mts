/**
 * hira-extract Product(BETA) + edi-extract 프롬프트 템플릿 v1 시드.
 *
 *   DATABASE_URL=... EXTRACT_PROCESSOR=https://... npx tsx scripts/seed-extract.mts
 *
 * - Product.processorUrl 은 processor 서비스 베이스 URL (게이트웨이가 {url}/extract 호출).
 *   hira-detect 와 동일 processor 이미지(=/process + /extract 동시 제공)를 가리켜도 됨.
 * - 템플릿은 코드 기본값(DEFAULT_EXTRACT_PROMPT/SCHEMA)을 DB v1(active)로 적재.
 */
import { prisma } from "@platform/db";
import {
  EDI_TEMPLATE_KEY,
  DEFAULT_EXTRACT_PROMPT,
  DEFAULT_EXTRACT_SCHEMA,
} from "../src/templates.js";

const PROCESSOR = process.env.EXTRACT_PROCESSOR ?? process.env.PROCESSOR ?? "http://localhost:8080";
const PRICE = Number(process.env.EXTRACT_PRICE_KRW ?? 300);
const MODEL = process.env.EXTRACT_MODEL ?? "gemini-3.1-flash-lite";

// 1) Product (BETA)
const product = await prisma.product.upsert({
  where: { slug: "hira-extract" },
  create: {
    slug: "hira-extract",
    name: "EDI 수량·금액 자동정리 (베타)",
    category: "제약 CSO",
    priceKrw: PRICE,
    billingUnit: "IMAGE",
    freeQuota: 10,
    processorUrl: PROCESSOR,
    status: "BETA",
    apiKind: "EXTRACT",
    description:
      "EDI·처방전 사진을 올리면 약품별 수량·처방량·단가·금액을 표로 정리해 드립니다. 숫자를 하나하나 옮겨 적고 계산이 맞는지 검산하던 일을 대신하고, 다시 확인이 필요한 항목만 콕 집어 알려 줍니다.",
  },
  update: { status: "BETA", processorUrl: PROCESSOR, priceKrw: PRICE, billingUnit: "IMAGE", apiKind: "EXTRACT", description: "EDI·처방전 사진을 올리면 약품별 수량·처방량·단가·금액을 표로 정리해 드립니다. 숫자를 하나하나 옮겨 적고 계산이 맞는지 검산하던 일을 대신하고, 다시 확인이 필요한 항목만 콕 집어 알려 줍니다." },
});
console.log(`Product: ${product.slug} (${product.status}, ${product.priceKrw}원/이미지) → ${product.processorUrl}`);

// 2) 프롬프트 템플릿 동기화 — 코드 기본(DEFAULT)과 다르면 새 버전으로 승격(이력 보존).
const latest = await prisma.promptTemplate.findFirst({ where: { key: EDI_TEMPLATE_KEY }, orderBy: { version: "desc" } });
const defaultBody = DEFAULT_EXTRACT_PROMPT;
const defaultSchema = JSON.stringify(DEFAULT_EXTRACT_SCHEMA);
const upToDate = latest && latest.body === defaultBody && JSON.stringify(latest.responseSchema) === defaultSchema;

if (upToDate) {
  console.log(`Template 최신: ${latest!.key} v${latest!.version} (active=${latest!.active}) — 유지`);
} else {
  const version = (latest?.version ?? 0) + 1;
  const t = await prisma.$transaction(async (tx) => {
    await tx.promptTemplate.updateMany({ where: { key: EDI_TEMPLATE_KEY }, data: { active: false } });
    return tx.promptTemplate.create({
      data: {
        key: EDI_TEMPLATE_KEY,
        version,
        title: `EDI 추출 기본 v${version}`,
        body: defaultBody,
        responseSchema: DEFAULT_EXTRACT_SCHEMA as any,
        model: MODEL,
        params: { temperature: 0 },
        active: true,
        parentId: latest?.id ?? null,
        createdBy: "seed",
      },
    });
  });
  console.log(`Template 승격: ${t.key} v${t.version} (active, model=${t.model}) id=${t.id}${latest ? ` (이전 v${latest.version} 비활성)` : ""}`);
}

await prisma.$disconnect();
