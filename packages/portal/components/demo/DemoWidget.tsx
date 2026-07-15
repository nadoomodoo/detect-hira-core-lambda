"use client";
import { useState } from "react";
import { DEMO_SAMPLES, type DemoSample } from "@/lib/demo-samples";

interface Item { code: string; manufacturer: string | null; drugName: string | null; found: boolean }
interface Result {
  items?: Item[];
  uniqueManufacturers?: string[];
  tagged?: boolean;
  rotation?: number;
  output?: { mode?: string; url?: string; base64?: string; contentType?: string };
  cost?: { krw: number; free: boolean };
  demoRemaining?: number | null;
}

export function DemoWidget() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [msg, setMsg] = useState("");
  const [isSample, setIsSample] = useState(false);

  function loadSample(s: DemoSample) {
    if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    setIsSample(true);
    setMsg("");
    setPreview(s.before);
    setAfter(s.after);
    setResult({ items: s.items, uniqueManufacturers: s.uniqueManufacturers, tagged: s.tagged });
    setStatus("done");
  }

  async function run(file: File) {
    if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    setIsSample(false);
    setPreview(URL.createObjectURL(file));
    setAfter(null);
    setResult(null);
    setMsg("");
    setStatus("loading");
    try {
      const resp = await fetch("/api/demo/detect", {
        method: "POST",
        headers: { "content-type": file.type || "image/jpeg" },
        body: file,
      });
      const json = await resp.json();
      if (!resp.ok) {
        setStatus("error");
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
      <div className="demo-samples-bar">
        <span className="muted" style={{ fontSize: 14 }}>샘플로 바로 체험:</span>
        {DEMO_SAMPLES.map((s) => (
          <button key={s.id} type="button" className="demo-chip" onClick={() => loadSample(s)}>
            {s.label}{s.placeholder ? " · 더미" : ""}
          </button>
        ))}
      </div>

      <label className="demo-drop">
        <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); }} />
        <div>
          <div className="demo-drop-title">처방전·EDI 이미지 업로드</div>
          <div className="muted">클릭해서 이미지를 선택하세요 (JPG/PNG). 하루 데모 횟수 제한이 있습니다.</div>
        </div>
      </label>

      {status === "loading" && <p className="muted" style={{ marginTop: 14 }}>처리 중… (OCR + 조회, 수 초 소요)</p>}
      {status === "error" && <p style={{ marginTop: 14, color: "#b91c1c" }}>{msg} {msg.includes("데모") && <a href="/signup">가입하기 →</a>}</p>}

      {status === "done" && result && (
        <div style={{ marginTop: 20 }}>
          {isSample && (
            <p className="muted" style={{ marginBottom: 12 }}>샘플(사전계산) 결과입니다 · 실제 이미지는 위에서 업로드해 보세요.</p>
          )}
          <div className="demo-images">
            {preview && <figure><figcaption className="muted">원본</figcaption><img src={preview} alt="원본" /></figure>}
            {after && <figure><figcaption className="muted">결과{result.tagged ? " (제약사별 태깅)" : ""}</figcaption><img src={after} alt="결과" /></figure>}
          </div>

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
          {typeof result.demoRemaining === "number" && (
            <p className="muted" style={{ marginTop: 12 }}>오늘 남은 데모 {result.demoRemaining}회 · <a href="/signup">가입하면 무제한</a></p>
          )}
        </div>
      )}
    </div>
  );
}
