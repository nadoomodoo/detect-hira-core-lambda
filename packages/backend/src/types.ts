/**
 * 공용 타입 정의
 */

/** Gemini가 반환한 정규화 좌표 (0~1000, [y1, x1, y2, x2] 순서) */
export type NormalizedBox = [number, number, number, number];

/** 픽셀 단위 좌표 (이미지 위에 그릴 때 사용) */
export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** OCR로 검출된 약가코드 1건 */
export interface DetectedCode {
  /** 검출된 원본 텍스트 (9자리 숫자) */
  code: string;
  /** 정규화된 bounding box [y1, x1, y2, x2] (0~1000) */
  box: NormalizedBox;
}

/** 마스터 조회 결과가 합쳐진 1건 */
export interface AnnotatedCode extends DetectedCode {
  /** 픽셀 단위 박스 */
  pixelBox: PixelBox;
  /** 제약사명 (조회 실패 시 null) */
  manufacturer: string | null;
  /** 의약품명 (조회 실패 시 null) */
  drugName: string | null;
  /** 마스터에 존재하는지 여부 */
  found: boolean;
}

/** 마스터 데이터 1행 */
export interface DrugRecord {
  drugCode: string;
  drugName: string;
  manufacturer: string;
  /** 약가 상한금액(원). 수량×단가 교차검증용. 미적재 시 null/undefined */
  unitPrice?: number | null;
}

/** 제약사(업체) 마스터 1행 — manufacturer_master CSV */
export interface ManufacturerRecord {
  /** 업체명 (drug master 의 manufacturer 와 조인 키) */
  name: string;
  /** 사업자번호 — 제약사 식별 키 */
  businessNumber: string;
  /** 주소 */
  address: string;
  /** 대표자 */
  ceo: string;
}

/** 이미지 처리 결과 */
export interface ProcessResult {
  /** 검출 + 마스터 조회된 결과 목록 */
  items: AnnotatedCode[];
  /** 원본 이미지 너비 (px) */
  width: number;
  /** 원본 이미지 높이 (px) */
  height: number;
  /** 조회 성공 항목의 유니크 제약사명 목록 (단일 제약사 스킵 판단용) */
  uniqueManufacturers: string[];
}
