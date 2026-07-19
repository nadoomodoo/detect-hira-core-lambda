"use client";
import { useState, type ComponentType } from "react";
import type { ApiKind } from "@platform/db";
import { DemoRunner } from "./DemoRunner";
import { BatchRunner } from "./BatchRunner";
import type { ResultViewProps } from "./types";
import { HiraDetectResult } from "./results/HiraDetectResult";
import { HiraExtractResult } from "./results/HiraExtractResult";
import { openImageInNewTab } from "./download";

/** API 종류별 결과 렌더러 — 같은 종류의 새 API 는 코드 변경 없이 자동 적용(SSOT=apiKind). */
const KIND_VIEWS: Record<string, ComponentType<ResultViewProps>> = {
  DETECT: HiraDetectResult,
  EXTRACT: HiraExtractResult,
};
/** slug별 특수 렌더러(선택) — 종류 기본과 다른 화면이 필요한 개별 API 만 등록. */
const SLUG_VIEWS: Record<string, ComponentType<ResultViewProps>> = {};

/** API 종류별 데모 엔드포인트. */
const KIND_ENDPOINTS: Record<string, string> = {
  DETECT: "/api/demo/detect",
  EXTRACT: "/api/demo/extract",
};

/** 배치(여러 장 병렬) 지원 종류 — 지원 종류만 단건/배치 토글 노출. 새 종류는 여기에 추가. */
const KIND_BATCH: Record<string, boolean> = {
  EXTRACT: true,
};

/** 기본(미등록 API): 원본 이미지 + 원시 JSON. */
function GenericResult({ result, preview, after }: ResultViewProps) {
  return (
    <>
      <div className="demo-images demo-images-single">
        {(after ?? preview) && <figure><figcaption className="muted">결과 (클릭하면 크게 보기)</figcaption><img src={(after ?? preview)!} alt="결과" style={{ cursor: "zoom-in" }} onClick={() => openImageInNewTab((after ?? preview)!)} /></figure>}
      </div>
      <pre style={{ marginTop: 12, maxHeight: 320, overflow: "auto", fontSize: 12.5 }}><code>{JSON.stringify(result.items ?? result, null, 2)}</code></pre>
    </>
  );
}

/** 데모 위젯 — 단건/배치 실행 + 결과 렌더러(apiKind 기본, slug 특수 override). */
export function DemoWidget({ slug, apiKind, loggedIn = false }: { slug: string; apiKind: ApiKind; loggedIn?: boolean }) {
  const ResultView = SLUG_VIEWS[slug] ?? KIND_VIEWS[apiKind] ?? GenericResult;
  const endpoint = KIND_ENDPOINTS[apiKind] ?? "/api/demo/detect";
  // 배치는 이 종류가 지원하고 로그인 상태일 때만(본인 과금·Job 소유).
  const batchable = !!KIND_BATCH[apiKind] && loggedIn;
  const [mode, setMode] = useState<"single" | "batch">("single");

  return (
    <div>
      {batchable && (
        <div role="tablist" aria-label="실행 방식" style={{ display: "inline-flex", gap: 4, padding: 4, background: "#f1f5f9", borderRadius: 10, marginBottom: 14 }}>
          {([["single", "단건"], ["batch", "배치 (여러 장)"]] as const).map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={mode === m ? "btn btn-sm" : "btn btn-sm btn-secondary"}
              style={mode === m ? {} : { background: "transparent", border: "none" }}>
              {label}
            </button>
          ))}
        </div>
      )}
      {batchable && mode === "batch"
        ? <BatchRunner slug={slug} apiKind={apiKind} />
        : <DemoRunner loggedIn={loggedIn} endpoint={endpoint} ResultView={ResultView} />}
    </div>
  );
}
