/**
 * drug_master_merged.csv → Cloud SQL DrugMaster 테이블 시드.
 *   실행: DATABASE_URL=... DRUG_MASTER_PATH=... npx tsx scripts/seed-drugmaster.mts
 */
import { parse } from "csv-parse";
import { createReadStream } from "node:fs";
import { PrismaClient } from "@platform/db";

const CSV = process.env.DRUG_MASTER_PATH;
if (!CSV) throw new Error("DRUG_MASTER_PATH 필요");

const prisma = new PrismaClient();

async function main() {
  // 1) CSV → dedup Map (9자리 숫자만)
  const rows = new Map<string, { drugCode: string; manufacturerName: string; drugName: string }>();
  await new Promise<void>((res, rej) => {
    const parser = parse({ columns: true, trim: true, bom: true, relax_column_count: true });
    createReadStream(CSV)
      .pipe(parser)
      .on("data", (r: Record<string, string>) => {
        const drugCode = r["drug_code"]?.trim();
        if (!drugCode || !/^\d{9}$/.test(drugCode)) return;
        rows.set(drugCode, {
          drugCode,
          manufacturerName: r["manufacturer"]?.trim() ?? "",
          drugName: r["drug_name"]?.trim() || null as any,
        });
      })
      .on("end", () => res())
      .on("error", rej);
  });
  console.log(`CSV 파싱: 유니크 코드 ${rows.size}건`);

  // 2) 배치 createMany (skipDuplicates)
  const all = [...rows.values()];
  const BATCH = 5000;
  let inserted = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH).map((d) => ({ ...d, source: "seed" }));
    const r = await prisma.drugMaster.createMany({ data: chunk, skipDuplicates: true });
    inserted += r.count;
    process.stdout.write(`\r적재 ${inserted}/${all.length}`);
  }
  console.log(`\n완료: DrugMaster ${await prisma.drugMaster.count()}행`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
