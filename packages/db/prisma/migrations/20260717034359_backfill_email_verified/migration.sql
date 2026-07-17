-- 데이터 마이그레이션: 이메일 인증 도입 이전 가입자 백필.
-- emailVerified 컬럼 추가 직후 기존 유저는 null 이 되어 credential 로그인이 차단된다.
-- 이 기능(2026-07-16) 도입 이전 가입자를 가입일(createdAt) 기준으로 인증됨 처리해 잠금을 방지한다.
-- 커트오프(2026-07-17) 이후 가입자는 인증 플로우를 타므로 건드리지 않는다(신규 미인증 오인증 방지).
UPDATE "User"
SET "emailVerified" = "createdAt"
WHERE "emailVerified" IS NULL
  AND "createdAt" < '2026-07-17T00:00:00Z';
