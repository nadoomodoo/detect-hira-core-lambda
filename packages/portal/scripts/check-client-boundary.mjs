#!/usr/bin/env node
// 빌드 전 클라이언트/서버 경계 가드.
// "use client" 컴포넌트가 서버 전용 코드(@platform/db·@prisma/client·@/lib/db)를
// 런타임으로 import 하면 DB 크리덴셜·쿼리가 브라우저 번들로 샐 수 있다.
// next build 는 이를 항상 깔끔히 막아주지 않으므로 여기서 명시적으로 차단한다.
// 주의: `import type ...` 은 빌드 시 소거되므로 안전 → 통과시킨다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "components", "lib"];
const SKIP = new Set(["node_modules", ".next", "dist"]);

// 서버 전용 모듈 — 클라이언트 컴포넌트에서 런타임 import 금지
const SERVER_ONLY = ["@platform/db", "@prisma/client", "@/lib/db"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function isClientComponent(src) {
  // 파일 상단 디렉티브: 첫 유효 토큰이 "use client" 문자열이어야 유효하지만,
  // 오탐보다 미탐이 위험하므로 상단 부분에 디렉티브가 있으면 클라이언트로 간주.
  return /^\s*["']use client["']\s*;?/m.test(src.slice(0, 500));
}

// 서버 전용 모듈에서의 런타임 import 만 잡는다 (`import type` 은 제외).
function offendingImports(src) {
  const hits = [];
  const importRe = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = importRe.exec(src))) {
    const isTypeOnly = !!m[1];
    const clause = m[2];
    const mod = m[3];
    if (!SERVER_ONLY.includes(mod)) continue;
    if (isTypeOnly) continue; // import type { ApiKind } — 소거됨, 안전
    // 인라인 타입만 가져오는 경우(import { type Foo })도 안전하지만
    // 런타임 바인딩이 하나라도 섞이면 위험 → 보수적으로 잡는다.
    const bindings = clause.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    const runtimeBindings = bindings.filter((b) => !b.startsWith("type "));
    if (runtimeBindings.length > 0) hits.push(`${mod} (${runtimeBindings.join(", ")})`);
  }
  return hits;
}

const violations = [];
for (const d of SCAN_DIRS) {
  let files;
  try {
    files = walk(join(ROOT, d));
  } catch {
    continue; // 디렉터리 없으면 스킵
  }
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!isClientComponent(src)) continue;
    const hits = offendingImports(src);
    if (hits.length) violations.push({ file: relative(ROOT, f), hits });
  }
}

if (violations.length) {
  console.error("\n❌ 클라이언트/서버 경계 위반 — 클라이언트 컴포넌트가 서버 전용 모듈을 런타임 import 합니다:\n");
  for (const v of violations) {
    console.error(`  ${v.file}`);
    for (const h of v.hits) console.error(`    ↳ ${h}`);
  }
  console.error(
    '\n해결: 해당 파일에서 "use client" 를 제거해 서버 컴포넌트로 두거나,\n' +
      "      DB 접근을 서버 컴포넌트/서버 액션/route handler 로 옮기세요.\n" +
      "      타입만 필요하면 `import type { ... }` 을 쓰면 통과합니다.\n"
  );
  process.exit(1);
}

console.log("✓ 클라이언트/서버 경계 검사 통과");
