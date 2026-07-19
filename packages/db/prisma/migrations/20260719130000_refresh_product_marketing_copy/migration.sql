-- 데이터 마이그레이션: 카탈로그 카드 설명을 기술 용어 제거 + 편익 중심 문구로 갱신.
-- 기존(프로드) 레코드의 description 이 옛 기술 설명(RT-DETR·좌표 JSON·신호등 등)으로 남아 있던 것을 정정. 멱등(slug 대상).
UPDATE "Product"
SET "name" = '멀티 제약사 자동 구분',
    "description" = '처방전·EDI 사진 한 장이면 어느 제약사 약인지 색깔로 표시해 드립니다. 여러 제약사 약이 섞여 있어도 한눈에 구분되고, 제약사별로 일일이 나눠 정리하던 수작업이 사라집니다.'
WHERE "slug" = 'hira-detect';

UPDATE "Product"
SET "name" = 'EDI 수량·금액 자동정리 (베타)',
    "description" = 'EDI·처방전 사진을 올리면 약품별 수량·처방량·단가·금액을 표로 정리해 드립니다. 숫자를 하나하나 옮겨 적고 계산이 맞는지 검산하던 일을 대신하고, 다시 확인이 필요한 항목만 콕 집어 알려 줍니다.'
WHERE "slug" = 'hira-extract';
