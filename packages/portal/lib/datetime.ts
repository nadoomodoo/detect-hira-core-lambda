/**
 * 날짜/시간 표시 공용 유틸 — 항상 한국 시간(KST, Asia/Seoul)으로 포맷.
 * 서버 렌더 시 런타임 TZ(UTC 등)에 좌우되지 않도록 timeZone 을 명시한다.
 * 페이지마다 toISOString()(=UTC)·toLocaleString() 이 섞여 표시가 달라지는 것을 방지.
 */

/** 날짜+시간(분까지) — 예: "2026. 07. 19. 오후 05:41". 거래/사용 내역 일시 표시용. */
export const fmtKST = (d: Date | string | number): string =>
  new Date(d).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

/** 날짜만 — 예: "2026. 07. 19.". 목록의 날짜 컬럼용. */
export const fmtKSTDate = (d: Date | string | number | null | undefined): string =>
  d == null
    ? "—"
    : new Date(d).toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric", month: "2-digit", day: "2-digit",
      });
