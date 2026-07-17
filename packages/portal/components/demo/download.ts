/** 브라우저 다운로드 트리거. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 이미지를 새 탭으로 연다.
 * data URI 는 브라우저가 새 탭 열람을 차단(about:blank#blocked)하므로 blob URL 로 변환해 연다.
 */
export async function openImageInNewTab(src: string) {
  if (src.startsWith("data:")) {
    try {
      const blob = await (await fetch(src)).blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000); // 탭이 로드할 시간 확보
      return;
    } catch { /* 폴백: 아래에서 직접 열기 */ }
  }
  window.open(src, "_blank", "noopener");
}
