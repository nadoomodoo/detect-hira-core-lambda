-- 멱등 키 보안 보강: (1) 요청 본문 해시 바인딩, (2) 결과 캐시.
-- 멱등(idempotent) 작성 — 프로드에 이미 있어도/없어도 안전하게 migrate deploy.

-- (1) CreditTx.bodyHash — 멱등 키에 묶인 요청 본문 sha256. 같은 키+다른 본문 재사용 차단.
ALTER TABLE "CreditTx" ADD COLUMN IF NOT EXISTS "bodyHash" TEXT;

-- (2) 결과 캐시 — 멱등 재요청 시 재처리 없이 이전 성공 응답을 반환.
CREATE TABLE IF NOT EXISTS "IdempotencyResult" (
  "requestId" TEXT NOT NULL,
  "status"    INTEGER NOT NULL,
  "result"    JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyResult_pkey" PRIMARY KEY ("requestId")
);
