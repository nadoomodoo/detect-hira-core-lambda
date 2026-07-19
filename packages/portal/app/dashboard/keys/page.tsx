import { auth } from "@/auth";
import { prisma } from "@platform/db";
import { StatusBadge } from "@/components/console/StatusBadge";
import { CreateKeyForm } from "./CreateKeyForm";
import { revokeKeyAction } from "./actions";
import { fmtKSTDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const fmt = fmtKSTDate;

export default async function Keys() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const keys = userId
    ? await prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })
    : [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>API 키</h1>
          <p className="purpose">호출 인증에 사용합니다. 발급 시 전체 키는 한 번만 표시됩니다.</p>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <CreateKeyForm />
      </div>

      <div className="collection">
        <div className="collection-toolbar"><span className="count"><b>{keys.length}</b>개 키</span></div>
        {keys.length === 0 ? (
          <div className="empty-state"><h3>발급된 키가 없습니다</h3><p>위 버튼으로 첫 API 키를 발급하세요.</p></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>프리픽스</th><th>상태</th><th>생성일</th><th>마지막 사용</th><th></th></tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="mono identity">{k.prefix}…</td>
                  <td>{k.active ? <StatusBadge kind="success" label="활성" /> : <StatusBadge kind="neutral" label="폐기됨" />}</td>
                  <td className="muted">{fmt(k.createdAt)}</td>
                  <td className="muted">{fmt(k.lastUsedAt)}</td>
                  <td className="row-actions">
                    {k.active && (
                      <form action={revokeKeyAction}>
                        <input type="hidden" name="id" value={k.id} />
                        <button className="btn btn-sm btn-danger" type="submit">폐기</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
