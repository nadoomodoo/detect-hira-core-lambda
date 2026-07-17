"use client";
import type { ComponentType } from "react";
import { DemoRunner } from "./DemoRunner";
import type { ResultViewProps } from "./types";
import { HiraDetectResult } from "./results/HiraDetectResult";

/** API별 결과 렌더러 등록. 새 API는 여기 한 줄 + 결과 컴포넌트만 추가하면 된다. */
const RESULT_VIEWS: Record<string, ComponentType<ResultViewProps>> = {
  "hira-detect": HiraDetectResult,
};

/** 기본(미등록 API): 원본 이미지 + 원시 JSON. */
function GenericResult({ result, preview, after }: ResultViewProps) {
  return (
    <>
      <div className="demo-images demo-images-single">
        {(after ?? preview) && <figure><figcaption className="muted">결과</figcaption><a href={(after ?? preview)!} target="_blank" rel="noopener noreferrer"><img src={(after ?? preview)!} alt="결과" /></a></figure>}
      </div>
      <pre style={{ marginTop: 12, maxHeight: 320, overflow: "auto", fontSize: 12.5 }}><code>{JSON.stringify(result.items ?? result, null, 2)}</code></pre>
    </>
  );
}

/** 데모 위젯 — 공통 실행 셸(DemoRunner) + API별 결과 렌더러(slug로 선택). */
export function DemoWidget({ slug, loggedIn = false }: { slug: string; loggedIn?: boolean }) {
  const ResultView = RESULT_VIEWS[slug] ?? GenericResult;
  return <DemoRunner loggedIn={loggedIn} ResultView={ResultView} />;
}
