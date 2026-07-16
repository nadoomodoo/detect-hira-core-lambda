import ExcelJS from "exceljs";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 코마케팅 업로드용 엑셀 양식(.xlsx) 다운로드. 어드민 전용. */
export async function GET() {
  const session = await auth();
  if ((session?.user as any)?.role !== "ADMIN") return new Response("forbidden", { status: 403 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("코마케팅 매핑");
  ws.columns = [
    { header: "약가코드(9자리)", key: "code", width: 18 },
    { header: "표기 제약사명", key: "disp", width: 28 },
    { header: "원 제약사명(선택)", key: "orig", width: 28 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getColumn(1).numFmt = "@"; // 텍스트 서식 — 선행 0 보존
  // 예시 행
  ws.addRow(["658107190", "코마케팅제약(주)", "한풍제약 주식회사"]);

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="comarketing-template.xlsx"',
    },
  });
}
