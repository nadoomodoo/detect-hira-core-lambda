import { BigQuery } from "@google-cloud/bigquery";

/**
 * 호출이력 → BigQuery 적재 (정산 근거).
 * best-effort: 실패해도 요청 흐름을 막지 않는다(과금 원장은 Postgres가 정본).
 * 스키마: infra/index.ts 의 platform.api_call_log 와 일치.
 */

const DATASET = process.env.BQ_DATASET ?? "platform";
const TABLE = process.env.BQ_TABLE ?? "api_call_log";
const ENABLED = process.env.USAGE_LOG !== "off";

let bq: BigQuery | null = null;
function client(): BigQuery {
  if (!bq) bq = new BigQuery();
  return bq;
}

export interface UsageRecord {
  ts: string; // ISO
  request_id: string;
  user_id: string;
  product_id: string;
  api_key_prefix?: string;
  status: "ok" | "fail" | "degraded";
  billable_count: number;
  cost_krw: number;
  free_used?: boolean;
  latency_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  display_names?: string[];
  error_code?: string;
  rotation?: number;
}

/** BigQuery 스트리밍 삽입. 오류는 삼키고 로그만 남긴다. */
export async function logUsage(rec: UsageRecord): Promise<void> {
  if (!ENABLED) {
    console.log("USAGE", JSON.stringify(rec));
    return;
  }
  try {
    await client().dataset(DATASET).table(TABLE).insert([rec]);
  } catch (err: any) {
    // insert 부분 실패(insertErrors)도 여기로 — 원장 정합엔 영향 없음
    const msg = err?.errors ? JSON.stringify(err.errors).slice(0, 500) : (err?.message ?? String(err));
    console.warn("usage_log_failed:", msg, "| rec:", JSON.stringify(rec));
  }
}
