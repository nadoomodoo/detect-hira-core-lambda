"use client";
import { useState, type ComponentType } from "react";
import type { DemoResult, ResultViewProps } from "./types";
import { downloadBlob } from "./download";

/** 긴 변이 MAX_EDGE 초과면 브라우저에서 축소 + JPEG 재인코딩(413 회피·업로드 가속). */
async function downscaleImage(file: File, MAX_EDGE = 3000, quality = 0.9): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_EDGE) { bitmap.close?.(); return file; }
    const scale = MAX_EDGE / longEdge;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * 데모 실행 공통 셸(이미지 업로드형): 업로드·축소·상태·에러·과금/한도·JSON 다운로드.
 * 결과 본문 렌더는 API별 ResultView 로 위임한다.
 */
export function DemoRunner({
  loggedIn = false,
  endpoint = "/api/demo/detect",
  ResultView,
}: {
  loggedIn?: boolean;
  endpoint?: string;
  ResultView: ComponentType<ResultViewProps>;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errKind, setErrKind] = useState("");
  const [msg, setMsg] = useState("");

  async function run(file: File) {
    if (preview) URL.revokeObjectURL(preview);
    setFileName(file.name);
    setPreview(URL.createObjectURL(file));
    setAfter(null); setResult(null); setMsg(""); setErrKind(""); setStatus("loading");
    try {
      const upload = await downscaleImage(file);
      const resp = await fetch(endpoint, { method: "POST", headers: { "content-type": upload.type || "image/jpeg" }, body: upload });
      const json = await resp.json();
      if (!resp.ok) {
        setStatus("error"); setErrKind(json.error ?? ""); setMsg(json.message ?? json.error ?? "처리에 실패했습니다.");
        return;
      }
      setAfter(json?.output?.url ?? (json?.output?.base64 ? `data:${json.output.contentType ?? "image/png"};base64,${json.output.base64}` : null));
      setResult(json);
      setStatus("done");
    } catch {
      setStatus("error"); setMsg("네트워크 오류가 발생했습니다.");
    }
  }

  return (
    <div className="demo">
      {/* 처리 중에는 업로드 영역을 숨기고 로딩만 표시 */}
      {status !== "loading" && (
        <label className="demo-drop">
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); }} />
          <div>
            <div className="demo-drop-title">처방전·EDI 이미지 업로드</div>
            <div className="muted">
              클릭해서 이미지를 선택하세요 (JPG/PNG).{" "}
              {loggedIn ? "무료 제공량 소진 후에는 크레딧에서 차감됩니다." : "비로그인은 하루 실행 횟수 제한이 있어요."}
            </div>
          </div>
        </label>
      )}

      {status === "loading" && (
        <div className="demo-loading" role="status" aria-live="polite">
          <span className="demo-spinner" aria-hidden="true" />
          <span>이미지 처리 중… <span className="muted">OCR + 제약사 조회 (수 초 소요)</span></span>
        </div>
      )}
      {status === "error" && (
        <p style={{ marginTop: 14, color: "#b91c1c" }}>
          {msg}{" "}
          {errKind === "insufficient_credit" && <a href="/dashboard/billing">크레딧 충전 →</a>}
          {errKind === "demo_limit" && !loggedIn && <a href="/login">로그인 →</a>}
        </p>
      )}

      {status === "done" && result && (
        <div style={{ marginTop: 20 }}>
          {/* API별 결과 */}
          <ResultView result={result} preview={preview} after={after} fileName={fileName} />

          {/* 공통: 데이터(JSON) 다운로드 */}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => downloadBlob("result.json", new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }))}>
              JSON 다운로드
            </button>
          </div>

          {/* 공통: 과금/한도 안내 */}
          {result.billed ? (
            <p className="muted" style={{ marginTop: 12 }}>
              이번 실행: {result.cost?.free ? <b style={{ color: "var(--success)" }}>무료 제공량 사용</b> : <b>{(result.cost?.krw ?? 0).toLocaleString()}원 차감</b>}
              {typeof result.balanceKrw === "number" && <> · 잔액 {result.balanceKrw.toLocaleString()}원</>}
              {" · "}<a href="/dashboard/billing">크레딧 관리</a>
            </p>
          ) : typeof result.demoRemaining === "number" ? (
            <p className="muted" style={{ marginTop: 12 }}>
              오늘 남은 무료 실행 {result.demoRemaining}회 · <a href="/login">로그인하면 계속 사용</a> (무료 제공량 후 크레딧 차감)
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
