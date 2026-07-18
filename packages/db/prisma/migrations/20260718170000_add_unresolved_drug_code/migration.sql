-- CreateTable: 마스터 미조회 약가코드 로그(dedup by drugCode)
CREATE TABLE "UnresolvedDrugCode" (
    "drugCode" TEXT NOT NULL,
    "codeType" TEXT NOT NULL,
    "drugName" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "sampleRequestId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "memo" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnresolvedDrugCode_pkey" PRIMARY KEY ("drugCode")
);

-- CreateIndex
CREATE INDEX "UnresolvedDrugCode_resolved_lastSeenAt_idx" ON "UnresolvedDrugCode"("resolved", "lastSeenAt");
CREATE INDEX "UnresolvedDrugCode_codeType_idx" ON "UnresolvedDrugCode"("codeType");
