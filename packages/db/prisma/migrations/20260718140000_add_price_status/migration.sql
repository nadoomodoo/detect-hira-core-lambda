-- AlterTable: 추출 행에 단가 변동 상태(SCD2 대조) 추가
ALTER TABLE "EdiExtractionRow" ADD COLUMN "priceStatus" TEXT;
