-- 데이터 마이그레이션: hira-detect 제품 카탈로그 명칭/설명 갱신(역할 반영: 멀티 제약사 라벨링).
-- 시드 upsert 의 update 절에 name 이 없어 기존(프로드) 레코드가 옛 이름으로 남았던 것을 정정. 멱등(slug 대상).
UPDATE "Product"
SET "name" = '멀티 제약사 라벨링',
    "category" = '제약 CSO',
    "description" = '처방전·EDI 이미지에서 약가코드를 검출해 제약사를 식별하고, 원본·라벨 이미지 + 좌표(JSON)를 반환합니다. 멀티 제약사는 색상 라벨을 합성하며, 좌표로 라벨 편집 에디터를 만들 수 있습니다.'
WHERE "slug" = 'hira-detect';
