"use client";
import { useCallback, useRef, useState } from "react";
import { Circle } from "lucide-react";
import { HiraExtractResult } from "./results/HiraExtractResult";
import type { DemoResult } from "./types";

/** 긴 변이 MAX_EDGE 초과면 브라우저에서 축소 + JPEG 재인코딩(업로드 페이로드 절감). */
async function downscale(file: File, MAX_EDGE = 3000, quality = 0.9): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const long = Math.max(bitmap.width, bitmap.height);
    if (long <= MAX_EDGE) { bitmap.close?.(); return file; }
    const scale = MAX_EDGE / long;
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

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

const MAX_ITEMS = 30;
const statusColor: Record<string, string> = { GREEN: "#16a34a", YELLOW: "#eab308", RED: "#dc2626" };
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

interface JobItemView {
  index: number;
  status: string; // pending | processing | ok | failed | dead
  error?: string;
  extractionId?: string;
  foundTable?: boolean;
  itemCount?: number;
  byStatus?: { green: number; yellow: number; red: number };
}
interface JobView {
  jobId: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  trafficLights: { green: number; yellow: number; red: number };
  totalCostKrw: number;
  items: JobItemView[];
}

const ITEM_LABEL: Record<string, string> = { pending: "대기", processing: "처리 중", ok: "완료", failed: "실패", dead: "실패" };

/** 대시보드 배치 추출 — 여러 장 업로드 → 비동기 Job 병렬 처리 → 개별 결과 그리드. */
export function BatchRunner() {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<"idle" | "submitting" | "running" | "done" | "error">("idle");
  const [job, setJob] = useState<JobView | null>(null);
  const [msg, setMsg] = useState("");
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [detail, setDetail] = useState<DemoResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setFiles((prev) => [...prev, ...imgs].slice(0, MAX_ITEMS));
  }, []);

  const reset = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    setFiles([]); setJob(null); setPhase("idle"); setMsg(""); setOpenIdx(null); setDetail(null);
  };

  async function poll(jobId: string) {
    try {
      const resp = await fetch(`/api/demo/jobs/${jobId}`, { cache: "no-store" });
      const j: JobView = await resp.json();
      if (!resp.ok) { setPhase("error"); setMsg((j as any).message ?? "폴링 실패"); return; }
      setJob(j);
      const terminal = j.status === "done" || j.status === "partial" || j.status === "failed";
      if (terminal) { setPhase("done"); return; }
      pollRef.current = setTimeout(() => poll(jobId), 1500);
    } catch {
      pollRef.current = setTimeout(() => poll(jobId), 2500);
    }
  }

  async function run() {
    if (files.length === 0) return;
    setPhase("submitting"); setMsg(""); setJob(null);
    try {
      const images = await Promise.all(files.map(async (f) => toBase64(await downscale(f))));
      const resp = await fetch("/api/demo/extract-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.jobId) {
        setPhase("error");
        setMsg(json.message ?? json.error ?? "배치 접수에 실패했습니다.");
        return;
      }
      setPhase("running");
      poll(json.jobId);
    } catch {
      setPhase("error"); setMsg("업로드 중 오류가 발생했습니다.");
    }
  }

  async function openDetail(it: JobItemView) {
    if (!it.extractionId) return;
    setOpenIdx(it.index); setDetail(null); setDetailLoading(true);
    try {
      const resp = await fetch(`/api/demo/extractions/${it.extractionId}`, { cache: "no-store" });
      const j = await resp.json();
      if (resp.ok) setDetail(j);
    } finally {
      setDetailLoading(false);
    }
  }

  const busy = phase === "submitting" || phase === "running";
  const tl = job?.trafficLights;

  return (
    <div className="demo">
      {phase === "idle" && (
        <>
          <label className="demo-drop">
            <input type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <div>
              <div className="demo-drop-title">EDI 이미지 여러 장 업로드</div>
              <div className="muted">클릭해서 여러 장을 선택하세요 (최대 {MAX_ITEMS}장). 병렬로 처리되고 결과를 개별로 볼 수 있어요.</div>
            </div>
          </label>

          {files.length > 0 && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {files.map((f, i) => (
                  <span key={i} className="badge" style={{ background: "#eef2ff", color: "#3730a3" }}>
                    {f.name}
                    <button type="button" aria-label="제거" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} style={{ marginLeft: 6, border: "none", background: "none", cursor: "pointer", color: "#6366f1" }}>✕</button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button className="btn" onClick={run}>{files.length}장 추출 실행</button>
                <button className="btn btn-secondary" onClick={() => setFiles([])}>비우기</button>
              </div>
            </>
          )}
        </>
      )}

      {busy && (
        <div className="demo-loading" role="status" aria-live="polite" style={{ flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <div><span className="demo-spinner" aria-hidden="true" /> {phase === "submitting" ? "업로드 중…" : `병렬 처리 중… ${job?.done ?? 0}/${job?.total ?? files.length} 완료`}</div>
          {job && (
            <div style={{ width: "100%", height: 8, background: "#eef2f7", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%`, height: "100%", background: "#4f46e5", transition: "width .3s" }} />
            </div>
          )}
        </div>
      )}

      {phase === "error" && <p style={{ marginTop: 14, color: "#b91c1c" }}>{msg}</p>}

      {job && (phase === "done" || phase === "running") && (
        <div style={{ marginTop: 18 }}>
          <div className="demo-note" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <b>{job.done}/{job.total} 완료</b>
            {job.failed > 0 && <span style={{ color: "#b91c1c" }}>실패 {job.failed}</span>}
            {tl && <span><Circle size={11} fill={statusColor.GREEN} stroke="none" /> {tl.green} · <Circle size={11} fill={statusColor.YELLOW} stroke="none" /> {tl.yellow} · <Circle size={11} fill={statusColor.RED} stroke="none" /> {tl.red}</span>}
            <span className="muted">원가 {won(job.totalCostKrw)}</span>
          </div>

          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table className="tbl">
              <thead><tr><th>#</th><th>파일</th><th>상태</th><th>추출</th><th>신호등</th><th></th></tr></thead>
              <tbody>
                {job.items.map((it) => {
                  const bs = it.byStatus;
                  return (
                    <tr key={it.index}>
                      <td className="muted">{it.index + 1}</td>
                      <td>{files[it.index]?.name ?? `#${it.index + 1}`}</td>
                      <td>
                        {it.status === "ok" ? <span style={{ color: "#16a34a" }}>완료</span>
                          : it.status === "failed" || it.status === "dead" ? <span style={{ color: "#b91c1c" }} title={it.error}>실패</span>
                          : <span className="muted">{ITEM_LABEL[it.status] ?? it.status}</span>}
                      </td>
                      <td className="num">{it.foundTable === false ? <span className="muted">표없음</span> : (it.itemCount ?? "—")}</td>
                      <td>{bs ? <span><Circle size={10} fill={statusColor.GREEN} stroke="none" /> {bs.green} · <Circle size={10} fill={statusColor.YELLOW} stroke="none" /> {bs.yellow} · <Circle size={10} fill={statusColor.RED} stroke="none" /> {bs.red}</span> : "—"}</td>
                      <td className="row-actions">
                        {it.extractionId && <button className="btn btn-sm btn-secondary" onClick={() => openDetail(it)}>보기</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {phase === "done" && (
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-secondary" onClick={reset}>새 배치</button>
            </div>
          )}
        </div>
      )}

      {openIdx !== null && (
        <div role="dialog" aria-modal="true" onClick={() => setOpenIdx(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 50, overflow: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 1040, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontWeight: 700 }}>{files[openIdx]?.name ?? `#${openIdx + 1}`} — 추출 결과</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setOpenIdx(null)}>닫기</button>
            </div>
            {detailLoading ? (
              <div className="demo-loading"><span className="demo-spinner" aria-hidden="true" /> 결과 불러오는 중…</div>
            ) : detail ? (
              <HiraExtractResult result={detail} preview={files[openIdx] ? URL.createObjectURL(files[openIdx]) : null} after={null} fileName={files[openIdx]?.name ?? null} />
            ) : (
              <p className="muted">결과를 불러오지 못했습니다.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
