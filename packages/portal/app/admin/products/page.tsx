import { Fragment } from "react";
import { prisma } from "@platform/db";
import { PRODUCT_STATUS } from "@/components/console/StatusBadge";
import { createProduct, updateProduct } from "./actions";

export const dynamic = "force-dynamic";

const UNIT_LABEL: Record<string, string> = { CALL: "호출", IMAGE: "이미지", PAGE: "페이지" };
const API_KIND_LABEL: Record<string, string> = { DETECT: "검출 (/detect)", EXTRACT: "추출 (/extract)" };
const ERRORS: Record<string, string> = {
  slug: "slug 는 소문자·숫자·하이픈만 사용할 수 있습니다 (예: hira-detect).",
  name: "이름을 입력하세요.",
  processor: "프로세서 URL 은 http(s):// 로 시작해야 합니다.",
  duplicate: "이미 존재하는 slug 입니다.",
};

export default async function Products({ searchParams }: { searchParams: Promise<{ error?: string; created?: string }> }) {
  const { error, created } = await searchParams;
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  const categories = Array.from(
    new Set(products.map((p) => p.category).filter((c): c is string => !!c)),
  ).sort();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>프로덕트</h1>
          <p className="purpose">API별 카테고리·설명·가격·무료쿼터·상태 (인라인 편집, 저장 시 이후 호출부터 적용)</p>
        </div>
      </div>

      {created && <div className="flashbar flashbar-success">새 프로덕트를 등록했습니다.</div>}
      {error && <div className="flashbar flashbar-error">{ERRORS[error] ?? "등록에 실패했습니다."}</div>}

      <datalist id="category-options">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>

      <details className="new-product">
        <summary>새 프로덕트 등록</summary>
        <div className="np-body">
          <form action={createProduct}>
            <div className="np-grid">
              <div className="np-field"><label>slug *</label><input name="slug" placeholder="hira-detect" required /></div>
              <div className="np-field"><label>이름 *</label><input name="name" placeholder="처방전 약가코드 검출" required /></div>
              <div className="np-field"><label>카테고리</label><input name="category" list="category-options" placeholder="제약 CSO" /></div>
              <div className="np-field"><label>단위</label>
                <select name="billingUnit" defaultValue="CALL">
                  {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="np-field"><label>API 종류</label>
                <select name="apiKind" defaultValue="DETECT">
                  {Object.entries(API_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="np-field"><label>가격(원)</label><input type="number" name="priceKrw" defaultValue={200} min={0} /></div>
              <div className="np-field"><label>무료쿼터</label><input type="number" name="freeQuota" defaultValue={10} min={0} /></div>
              <div className="np-field"><label>상태</label>
                <select name="status" defaultValue="BETA">
                  {Object.entries(PRODUCT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="np-field full"><label>프로세서 URL *</label><input name="processorUrl" placeholder="https://processor-xxx.asia-northeast3.run.app" required /></div>
              <div className="np-field full"><label>설명 (랜딩 카탈로그 표시)</label><textarea name="description" rows={2} placeholder="처방전 이미지에서 약가코드를 검출하고 제약사를 태깅합니다." /></div>
            </div>
            <button className="btn" type="submit">등록</button>
          </form>
        </div>
      </details>

      <div className="collection">
        <div className="collection-toolbar"><span className="count"><b>{products.length}</b>개 프로덕트</span></div>
        {products.length === 0 ? (
          <div className="empty-state"><h3>프로덕트가 없습니다</h3><p>새 API 프로세서를 배포한 뒤 등록하세요.</p></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>slug</th><th>이름</th><th>카테고리</th><th>상태</th><th>종류</th>
                <th className="num">가격(원)</th><th>단위</th><th className="num">무료</th><th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <Fragment key={p.id}>
                  <tr>
                    <td className="mono identity">{p.slug}</td>
                    <td>{p.name}</td>
                    <td>
                      <form id={`f-${p.id}`} action={updateProduct}>
                        <input type="hidden" name="id" value={p.id} />
                      </form>
                      <input className="cell-input" type="text" name="category" form={`f-${p.id}`} defaultValue={p.category ?? ""} list="category-options" placeholder="제약 CSO" style={{ width: 120 }} />
                    </td>
                    <td>
                      <select name="status" form={`f-${p.id}`} defaultValue={p.status} className="cell-select">
                        {Object.entries(PRODUCT_STATUS).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select name="apiKind" form={`f-${p.id}`} defaultValue={p.apiKind} className="cell-select">
                        {Object.entries(API_KIND_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num"><input className="cell-input num" type="number" name="priceKrw" form={`f-${p.id}`} defaultValue={p.priceKrw} min={0} /></td>
                    <td>{UNIT_LABEL[p.billingUnit] ?? p.billingUnit}</td>
                    <td className="num"><input className="cell-input num" type="number" name="freeQuota" form={`f-${p.id}`} defaultValue={p.freeQuota} min={0} style={{ width: 64 }} /></td>
                    <td className="row-actions"><button className="btn btn-sm" type="submit" form={`f-${p.id}`}>저장</button></td>
                  </tr>
                  <tr className="desc-row">
                    <td></td>
                    <td colSpan={8}>
                      <label className="desc-label">설명 (랜딩 카탈로그 표시)</label>
                      <textarea className="cell-textarea" name="description" form={`f-${p.id}`} defaultValue={p.description ?? ""} rows={2} placeholder="처방전 이미지에서 약가코드를 검출하고 제약사를 태깅합니다." />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted" style={{ marginTop: 16 }}>가격은 변경 후 호출부터 적용됩니다. 과거 호출·정산은 당시 스냅샷 가격을 유지합니다.</p>
    </>
  );
}
