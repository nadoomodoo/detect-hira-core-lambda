-- AlterTable: DrugMaster 단가(상한금액) 추가
ALTER TABLE "DrugMaster" ADD COLUMN "unitPrice" INTEGER;

-- AlterTable: Job 실패/신호등 집계 + 상태 확장
ALTER TABLE "Job" ADD COLUMN "failed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN "greenCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN "yellowCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN "redCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: JobItem 재시도/갱신시각
ALTER TABLE "JobItem" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobItem" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex: JobItem 상태별 조회 (DLQ/재시도)
CREATE INDEX "JobItem_status_idx" ON "JobItem"("status");

-- CreateTable: PromptTemplate (프롬프트 이력관리)
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "responseSchema" JSONB NOT NULL,
    "model" TEXT,
    "params" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_key_version_key" ON "PromptTemplate"("key", "version");
CREATE INDEX "PromptTemplate_key_active_idx" ON "PromptTemplate"("key", "active");

-- CreateTable: EdiExtraction (추출 요청 결과)
CREATE TABLE "EdiExtraction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceImageUrl" TEXT,
    "croppedImageUrl" TEXT,
    "cropMeta" JSONB,
    "templateId" TEXT,
    "templateKey" TEXT,
    "templateVersion" INTEGER,
    "foundTable" BOOLEAN NOT NULL DEFAULT false,
    "columnsRaw" JSONB,
    "status" TEXT NOT NULL DEFAULT 'done',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EdiExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EdiExtraction_requestId_key" ON "EdiExtraction"("requestId");
CREATE INDEX "EdiExtraction_userId_createdAt_idx" ON "EdiExtraction"("userId", "createdAt");

-- CreateTable: EdiExtractionRow (추출 행)
CREATE TABLE "EdiExtractionRow" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "drugCode" TEXT,
    "drugName" TEXT,
    "manufacturer" TEXT,
    "quantity" DOUBLE PRECISION,
    "days" DOUBLE PRECISION,
    "prescribedQty" DOUBLE PRECISION,
    "unitPrice" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION,
    "raw" JSONB NOT NULL,
    "codeValid" BOOLEAN NOT NULL DEFAULT false,
    "codeType" TEXT NOT NULL DEFAULT 'none',
    "mathValid" BOOLEAN NOT NULL DEFAULT false,
    "priceValid" BOOLEAN,
    "confidence" DOUBLE PRECISION,
    "trafficLight" TEXT NOT NULL DEFAULT 'RED',
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewFlags" JSONB,
    "recropPass" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EdiExtractionRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EdiExtractionRow_extractionId_idx" ON "EdiExtractionRow"("extractionId");
CREATE INDEX "EdiExtractionRow_needsReview_idx" ON "EdiExtractionRow"("needsReview");

-- CreateTable: UsageCost (원가 추적)
CREATE TABLE "UsageCost" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "jobItemId" TEXT,
    "userId" TEXT,
    "productId" TEXT,
    "stage" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "templateId" TEXT,
    "calls" INTEGER NOT NULL DEFAULT 1,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION,
    "costKrw" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "benchRun" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageCost_requestId_idx" ON "UsageCost"("requestId");
CREATE INDEX "UsageCost_model_createdAt_idx" ON "UsageCost"("model", "createdAt");
CREATE INDEX "UsageCost_productId_createdAt_idx" ON "UsageCost"("productId", "createdAt");
CREATE INDEX "UsageCost_benchRun_idx" ON "UsageCost"("benchRun");

-- AddForeignKey
ALTER TABLE "EdiExtractionRow" ADD CONSTRAINT "EdiExtractionRow_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "EdiExtraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
