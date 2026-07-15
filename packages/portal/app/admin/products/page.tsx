import { Fragment } from "react";
import { prisma } from "@platform/db";
import { PRODUCT_STATUS } from "@/components/console/StatusBadge";
import { updateProduct } from "./actions";

export const dynamic = "force-dynamic";

const UNIT_LABEL: Record<string, string> = { CALL: "호출", IMAGE: "이미지", PAGE: "페이지" };

export default async function Products() {
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

      <datalist id="category-options">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>

      <div className="collection">
        <div className="collection-toolbar"><span className="count"><b>{products.length}</b>개 프로덕트</span></div>
        {products.length === 0 ? (
          <div className="empty-state"><h3>프로덕트가 없습니다</h3><p>새 API 프로세서를 배포한 뒤 등록하세요.</p></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>slug</th><th>이름</th><th>카테고리</th><th>상태</th>
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
                    <td className="num"><input className="cell-input num" type="number" name="priceKrw" form={`f-${p.id}`} defaultValue={p.priceKrw} min={0} /></td>
                    <td>{UNIT_LABEL[p.billingUnit] ?? p.billingUnit}</td>
                    <td className="num"><input className="cell-input num" type="number" name="freeQuota" form={`f-${p.id}`} defaultValue={p.freeQuota} min={0} style={{ width: 64 }} /></td>
                    <td className="row-actions"><button className="btn btn-sm" type="submit" form={`f-${p.id}`}>저장</button></td>
                  </tr>
                  <tr className="desc-row">
                    <td></td>
                    <td colSpan={7}>
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
