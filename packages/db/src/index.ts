// 공유 DB 패키지 — Prisma 스키마·클라이언트의 단일 원천.
// backend·portal 이 이 패키지를 import 한다 (심링크/복사 없음).
export * from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma: PrismaClient = g.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;

// 약가 상한금액표 SCD Type 2 적재 (CLI·어드민 공용)
export { ingestDrugPriceTable, parsePriceSheet } from "./priceIngest.js";
export type { PriceRow, IngestOptions, IngestResult } from "./priceIngest.js";
