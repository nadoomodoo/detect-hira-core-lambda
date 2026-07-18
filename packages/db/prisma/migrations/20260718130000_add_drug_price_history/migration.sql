-- AlterTable: DrugMaster 현재 단가 기준일 + source 확장(문자열이라 스키마 변경 불필요)
ALTER TABLE "DrugMaster" ADD COLUMN "priceEffectiveFrom" TIMESTAMP(3);

-- CreateTable: DrugPriceHistory (SCD Type 2)
CREATE TABLE "DrugPriceHistory" (
    "id" TEXT NOT NULL,
    "drugCode" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "drugName" TEXT,
    "manufacturerName" TEXT,
    "batch" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "current" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DrugPriceHistory_drugCode_current_idx" ON "DrugPriceHistory"("drugCode", "current");
CREATE INDEX "DrugPriceHistory_drugCode_validFrom_idx" ON "DrugPriceHistory"("drugCode", "validFrom");
CREATE INDEX "DrugPriceHistory_current_idx" ON "DrugPriceHistory"("current");
