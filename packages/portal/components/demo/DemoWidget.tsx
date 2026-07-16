"use client";
import { useState } from "react";

/** 긴 변이 MAX_EDGE 초과면 브라우저에서 축소 + JPEG 재인코딩. 실패/소형이면 원본 그대로. */
async function downscaleImage(file: File, MAX_EDGE = 3000, quality = 0.9): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_EDGE) { bitmap.close?.(); return file; }
    const scale = MAX_EDGE / longEdge;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

interface Item { code: string; manufacturer: string | null; drugName: string | null; found: boolean }
interface Result {
  items?: Item[];
  uniqueManufacturers?: string[];
  tagged?: boolean;
  output?: { mode?: string; url?: string; base64?: string; contentType?: string };
  cost?: { krw: number; free: boolean };
  balanceKrw?: number;
  demoRemaining?: number | null;
  billed?: boolean;
}

export function DemoWidget({ loggedIn = false }: { loggedIn?: boolean }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [errKind, setErrKind] = useState<string>("");
  const [msg, setMsg] = useState("");

  async function run(file: File) {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setAfter(null); setResult(null); setMsg(""); setErrKind(""); setStatus("loading");
    try {
      const upload = await downscaleImage(file); // 413 회피·업로드 가속
      const resp = await fetch("/api/demo/detect", {
        method: "POST",
        headers: { "content-type": upload.type || "image/jpeg" },
        body: upload,
      });
      const json = await resp.json();
      if (!resp.ok) {
        setStatus("error");
        setErrKind(json.error ?? "");
        setMsg(json.message ?? json.error ?? "처리에 실패했습니다.");
        return;
      }
      setAfter(
        json?.output?.url ??
          (json?.output?.base64 ? `data:${json.output.contentType ?? "image/png"};base64,${json.output.base64}` : null),
      );
      setResult(json);
      setStatus("done");
    } catch {
      setStatus("error");
      setMsg("네트워크 오류가 발생했습니다.");
    }
  }

  return (
    <div className="demo">
      <label className="demo-drop">
        <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); }} />
        <div>
          <div className="demo-drop-title">처방전·EDI 이미지 업로드</div>
          <div className="muted">
            클릭해서 이미지를 선택하세요 (JPG/PNG).{" "}
            {loggedIn ? "무료 제공량 소진 후에는 크레딧에서 차감됩니다." : "비로그인은 하루 체험 횟수 제한이 있어요."}
          </div>
        </div>
      </label>

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
          {result.tagged ? (
            <div className="demo-images">
              {preview && <figure><figcaption className="muted">원본</figcaption><img src={preview} alt="원본" /></figure>}
              {after && <figure><figcaption className="muted">결과 (제약사별 색상 태깅)</figcaption><img src={after} alt="결과" /></figure>}
            </div>
          ) : (
            <div>
              <div className="demo-images demo-images-single">
                {preview && <figure><figcaption className="muted">원본</figcaption><img src={preview} alt="원본" /></figure>}
              </div>
              <p className="demo-note">
                ✓ <b>단일 제약사</b> 처방전입니다 — 색상 라벨 합성 없이 <b>원본이 그대로 반환</b>됩니다.
                (2곳 이상이면 제약사별로 색상 태깅한 결과 이미지를 반환합니다.)
              </p>
            </div>
          )}

          <h3 style={{ marginTop: 20, fontSize: 16, fontWeight: 700 }}>검출 결과 {result.items?.length ?? 0}건</h3>
          <table className="tbl" style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 8 }}>
            <thead><tr><th>약가코드</th><th>제약사</th><th>의약품</th></tr></thead>
            <tbody>
              {(result.items ?? []).map((it, i) => (
                <tr key={i}>
                  <td className="mono">{it.code}</td>
                  <td>{it.manufacturer ?? <span className="muted">미조회</span>}</td>
                  <td className="muted">{it.drugName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.billed ? (
            <p className="muted" style={{ marginTop: 12 }}>
              이번 호출: {result.cost?.free ? <b style={{ color: "var(--success)" }}>무료 제공량 사용</b> : <b>{(result.cost?.krw ?? 0).toLocaleString()}원 차감</b>}
              {typeof result.balanceKrw === "number" && <> · 잔액 {result.balanceKrw.toLocaleString()}원</>}
              {" · "}<a href="/dashboard/billing">크레딧 관리</a>
            </p>
          ) : typeof result.demoRemaining === "number" ? (
            <p className="muted" style={{ marginTop: 12 }}>
              오늘 남은 무료 체험 {result.demoRemaining}회 · <a href="/login">로그인하면 계속 사용</a> (무료 제공량 후 크레딧 차감)
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
