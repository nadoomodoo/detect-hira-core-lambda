-- 크롭 실패(fallback) 원본을 데이터셋으로 수집하기 위한 참조 컬럼.
-- datasetKey: GCS_RESULT_BUCKET 내 failed-crops/… 객체 키(영구). datasetUrl: 미리보기용 서명 URL(만료).
ALTER TABLE "EdiExtraction" ADD COLUMN "datasetKey" TEXT;
ALTER TABLE "EdiExtraction" ADD COLUMN "datasetUrl" TEXT;

-- 데이터셋 목록(datasetKey IS NOT NULL) 조회 인덱스.
CREATE INDEX "EdiExtraction_datasetKey_idx" ON "EdiExtraction"("datasetKey");
