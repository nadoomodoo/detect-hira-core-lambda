/** 데모 실행 공통 타입. API별 결과는 result 안에 자유 형태로 담긴다. */
export interface DemoResult {
  // 이미지형 결과(OCR 계열) 공통 필드
  output?: { mode?: string; url?: string; base64?: string; contentType?: string };
  // 과금/한도 공통
  cost?: { krw: number; free: boolean };
  balanceKrw?: number;
  demoRemaining?: number | null;
  billed?: boolean;
  // API별 필드
  [key: string]: unknown;
}

/** API별 결과 렌더러가 받는 props (공통 러너가 주입). */
export interface ResultViewProps {
  result: DemoResult;
  preview: string | null; // 업로드 원본 미리보기(blob URL)
  after: string | null; // 결과 이미지(output에서 파생)
  fileName: string | null; // 업로드한 원본 파일명(다운로드 파일명 생성용)
}
