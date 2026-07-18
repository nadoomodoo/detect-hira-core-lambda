"use client";
import type { ComponentType } from "react";
import type { ApiKind } from "@platform/db";
import { DemoRunner } from "./DemoRunner";
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

/** 데모 위젯 — 공통 실행 셸(DemoRunner) + 결과 렌더러(apiKind 기본, slug 특수 override). */
export function DemoWidget({ slug, apiKind, loggedIn = false }: { slug: string; apiKind: ApiKind; loggedIn?: boolean }) {
  const ResultView = SLUG_VIEWS[slug] ?? KIND_VIEWS[apiKind] ?? GenericResult;
  const endpoint = KIND_ENDPOINTS[apiKind] ?? "/api/demo/detect";
  return <DemoRunner loggedIn={loggedIn} endpoint={endpoint} ResultView={ResultView} />;
}
