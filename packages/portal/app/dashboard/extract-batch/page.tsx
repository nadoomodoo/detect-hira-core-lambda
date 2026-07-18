import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@platform/db";
import { BatchRunner } from "@/components/demo/BatchRunner";

export const dynamic = "force-dynamic";

/** 대시보드 배치 추출 — 여러 EDI 이미지를 비동기 Job 으로 병렬 처리하고 개별 결과를 확인. */
export default async function ExtractBatchPage() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) redirect("/login");

  const product = await prisma.product.findUnique({ where: { slug: "hira-extract" }, select: { name: true, priceKrw: true, freeQuota: true, status: true } }).catch(() => null);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>배치 추출</h1>
          <p className="purpose">
            EDI 이미지를 여러 장 올려 <b>병렬로 처리</b>하고 결과를 개별로 확인합니다.
            {product ? <> · {product.name} · {product.priceKrw.toLocaleString()}원/이미지(무료 {product.freeQuota}회 후 차감)</> : null}
          </p>
        </div>
      </div>

      {!product || product.status === "DEPRECATED" ? (
        <div className="empty-state"><h3>준비 중</h3><p>배치 추출 API가 아직 활성화되지 않았습니다.</p></div>
      ) : (
        <BatchRunner />
      )}
    </>
  );
}
