import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { createVersion, activateVersion } from "./actions";

/**
 * 프롬프트 템플릿 이력관리 — key 별 버전 목록, 활성본 표시, 새 버전 생성/롤백.
 * 적용은 templateId 또는 key 의 active 최신본 기준(백엔드 templates.ts).
 */
export const dynamic = "force-dynamic";
const fmt = (d: Date) => new Date(d).toISOString().slice(0, 16).replace("T", " ");

const DEFAULT_SCHEMA = JSON.stringify(
  {
    type: "OBJECT",
    properties: {
      found_drug_table: { type: "BOOLEAN" },
      columns: { type: "ARRAY", items: { type: "STRING" } },
      rows: { type: "ARRAY", items: { type: "ARRAY", items: { type: "STRING" } } },
    },
    required: ["found_drug_table", "columns", "rows"],
  },
  null,
  2,
);

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; created?: string; error?: string }>;
}) {
  const { key: selKey, created, error } = await searchParams;
  const all = await prisma.promptTemplate.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });

  // key 별 그룹
  const byKey = new Map<string, typeof all>();
  for (const t of all) {
    if (!byKey.has(t.key)) byKey.set(t.key, [] as any);
    byKey.get(t.key)!.push(t);
  }
  const keys = [...byKey.keys()];
  const activeKey = selKey && byKey.has(selKey) ? selKey : keys[0] ?? "edi-extract";
  const versions = byKey.get(activeKey) ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>프롬프트 템플릿</h1>
          <p className="purpose">DB 기반 이력관리 — key별 버전 관리·활성화·롤백. 추출 API는 templateId 또는 active 최신본을 적용합니다.</p>
        </div>
      </div>

      {created && <div className="flashbar flashbar-success">v{created} 버전이 생성되었습니다.</div>}
      {error === "required" && <div className="flashbar flashbar-error">key와 본문(body)은 필수입니다.</div>}
      {error === "badschema" && <div className="flashbar flashbar-error">responseSchema JSON 파싱 실패. 올바른 JSON인지 확인하세요.</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {keys.map((k) => (
          <a key={k} className={`btn btn-sm ${k === activeKey ? "" : "btn-secondary"}`} href={`/admin/prompts?key=${encodeURIComponent(k)}`}>
            {k}
          </a>
        ))}
      </div>

      <div className="collection" style={{ marginBottom: 24 }}>
        <div className="collection-toolbar">
          <span className="count"><b>{activeKey}</b> — {versions.length}개 버전</span>
        </div>
        {versions.length === 0 ? (
          <div className="empty-state"><h3>버전이 없습니다</h3><p>아래에서 v1을 생성하세요.</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>버전</th><th>제목</th><th>모델</th><th>상태</th><th>생성</th><th></th></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td className="mono">v{v.version}</td>
                  <td>{v.title ?? "—"}</td>
                  <td className="muted mono">{v.model ?? "기본"}</td>
                  <td>{v.active ? <StatusBadge kind="success" label="활성" /> : <StatusBadge kind="neutral" label="—" />}</td>
                  <td className="muted">{fmt(v.createdAt)}</td>
                  <td className="row-actions" style={{ textAlign: "right" }}>
                    {!v.active && (
                      <form action={activateVersion} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="key" value={v.key} />
                        <button className="btn btn-sm btn-secondary" type="submit">활성화</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 활성 버전 본문 미리보기 */}
      {versions.find((v) => v.active) && (
        <div className="form-section" style={{ marginBottom: 24 }}>
          <h3 style={{ fontWeight: 700 }}>활성 버전 본문 (v{versions.find((v) => v.active)!.version})</h3>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, background: "#f8f8f8", padding: 12, borderRadius: 6, maxHeight: 240, overflow: "auto" }}>
            {versions.find((v) => v.active)!.body}
          </pre>
        </div>
      )}

      <form className="form-section stack" action={createVersion}>
        <h3 style={{ fontWeight: 700 }}>새 버전 생성</h3>
        <div className="field"><label>key</label><input name="key" defaultValue={activeKey} required /></div>
        <div className="field"><label>제목</label><input name="title" placeholder="예: 컬럼밀림 강화 v2" /></div>
        <div className="field"><label>모델 (선택)</label><input name="model" placeholder="예: gemini-3.5-flash-lite" /></div>
        <div className="field"><label>temperature</label><input name="temperature" type="number" step="0.1" defaultValue="0" /></div>
        <div className="field"><label>본문 (body)</label><textarea name="body" rows={12} required defaultValue={versions.find((v) => v.active)?.body ?? ""} /></div>
        <div className="field"><label>responseSchema (JSON)</label><textarea name="responseSchema" rows={10} required defaultValue={
          versions.find((v) => v.active) ? JSON.stringify(versions.find((v) => v.active)!.responseSchema, null, 2) : DEFAULT_SCHEMA
        } /></div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="activate" defaultChecked /> 생성 후 바로 활성화</label>
        <button className="btn btn-sm" type="submit">버전 생성</button>
      </form>
    </>
  );
}
