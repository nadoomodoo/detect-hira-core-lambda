# 프론트엔드 · 어드민 UI/UX 기획

> 작성일: 2026-07-15
> 상위 문서: [PLATFORM-PLAN.md](./PLATFORM-PLAN.md)
> 디자인 표준: [design.md](../design.md) — **어드민은 이 문서의 수용 기준(Nadoo Cloud Console)을 그대로 따른다**

---

## 1. 원칙

- **어드민(`/admin`)은 `design.md` 표준을 100% 준수**: 리소스-우선 컬렉션, `AdminAppShell`/`AdminCollection`/`AdminTable` 등 공유 프리미티브 재사용, 상태 어휘(success/info/warning/error/neutral), 짧은 폼, 반응형 카드, 포털 오버레이. 설명은 help 패널로, 화면 위 서사 카드 금지.
- **고객 프론트엔드**는 셀프서브 지향의 가벼운 표면. 랜딩만 `design.md`가 허용하는 hero 사용(제품 랜딩/온보딩 예외). 대시보드/키/이력은 콘솔 컬렉션 패턴 재사용.
- **한 시스템, 두 관객, 세 접근 등급.** 어드민은 같은 Next.js 앱의 `/admin` 라우트로 구현.

---

## 2. 접근 등급 & 인증

| 등급 | 대상 | 인증 | 범위 |
|---|---|---|---|
| **Public** | 누구나 | 없음 | 랜딩·제품·문서·가격 |
| **Customer** | 구매자(파트너) | NextAuth (Google/이메일) | `/dashboard/*` — 키·크레딧·이력·신청 |
| **Admin** | nadoomodoo.com 직원 | **Google OpenID + `hd=nadoomodoo.com` 강제 + role=admin** | `/admin/*` |

### 어드민 접근 제한 구현 (Google OpenID, nadoomodoo.com 한정)
- NextAuth Google Provider `signIn` 콜백에서:
  1. `profile.hd === "nadoomodoo.com"` (Google Workspace hosted-domain 클레임) 아니면 거부.
  2. `hd`는 위조 가능성 대비 **ID 토큰 검증 + 이메일 도메인 재확인**, 추가로 **어드민 이메일 허용목록/role 테이블** 확인.
  3. `User.role = admin` 부여된 계정만 통과.
- **미들웨어**(`middleware.ts`)가 `/admin/*`를 role=admin으로 게이트. 비인가 접근은 404(존재 은닉) 또는 403.
- 고객 로그인과 별개 게이트: 고객은 넓게 허용, 어드민은 hd+role 이중 잠금.

---

## 3. 사이트맵

```
Public / Customer (고객 프론트엔드)
  /                      랜딩 — API 카탈로그 (Product 목록)
  /products/[slug]       제품 상세 (설명·가격·무료10회·문서·시작하기)
  /products/[slug]/docs  API 레퍼런스
  /login  /signup
  /dashboard             개요 (잔액·최근 사용·키 요약)
  /dashboard/keys        API 키 (목록/발급/폐기)
  /dashboard/usage       호출 이력 (BigQuery, 제품·기간 필터)
  /dashboard/billing     크레딧 잔액 + 거래 내역(충전/과금/환불)
  /dashboard/apply       사용신청 폼 (무료10회 초과)

Admin (/admin — nadoomodoo.com 전용)
  /admin                 대시보드 (시스템 상태·매출·대기 신청)
  /admin/products        프로덕트 컬렉션 (CRUD: 가격·단위·무료쿼터·상태)
  /admin/products/[id]   프로덕트 상세/편집
  /admin/users           유저 컬렉션 (잔액·무료사용·최근 호출)
  /admin/users/[id]      유저 상세 (Entitlement·거래이력·수동충전)
  /admin/credits         거래 원장 컬렉션 + 수동충전
  /admin/requests        사용신청 컬렉션 (상태 관리)
  /admin/comarketing     코마케팅 매핑 컬렉션 (CRUD + CSV 임포트)
  /admin/usage           호출이력/정산 (BigQuery, 제품·월별)
```

---

## 4. 고객 프론트엔드 상세

### 4.1 `/` 랜딩 — API 카탈로그
- **패턴**: 제품 랜딩(hero 허용) + 아래 **Product 카탈로그 그리드**.
- Product 테이블 기반 렌더 → 새 API 추가 시 자동 노출.
- 카드당: 제품명·한줄 설명·가격(예: `200원/호출`)·`무료 10회`·[시작하기]·[문서].
- 상단: 로그인/가입, 제품 소개, 가격.
- 카피: 마케팅 과장 금지, present-tense, 핵심 가치 한 줄.

### 4.2 `/products/[slug]` 제품 상세
- 무엇을 하는 API인지, 입력/출력 예시(Before/After 이미지 — HIRA는 태깅 예시), 가격·단위·무료쿼터, [키 발급] CTA, 문서 링크.

### 4.3 `/products/[slug]/docs` API 레퍼런스
- 엔드포인트·요청/응답 스키마·cURL 예시·에러 코드·rate/quota 안내. 코드 블록 monospace.

### 4.4 `/dashboard` 개요 (Dashboard 템플릿)
- 요약 지표 3–5개만: **크레딧 잔액(원)**, 이번 달 호출 수, 잔여 무료횟수, 활성 키 수.
- 최근 호출 5건 + [전체 이력]. 잔액 부족 시 경고 flashbar + [충전 안내/신청].
- 대시보드 아이템당 primary action 최대 1개.

### 4.5 `/dashboard/keys` API 키 (Collection)
- 컬럼: `프리픽스(식별)` · `상태` · `생성일` · `마지막 사용` · 액션.
- 헤더 액션: [키 발급]. 발급 시 **전체 키를 1회만 표시**(이후 해시만 저장) — 복사 유도, 재발급 가능.
- 행 액션: 폐기(위험 확인). `tabular-nums`로 날짜.
- 계정 단위 공용 키(모든 구독 제품 호출) — O1 기본안.

### 4.6 `/dashboard/usage` 호출 이력 (Collection, BigQuery)
- 컬럼: `시각(절대)` · `제품` · `상태(ok/fail/degraded)` · `건수(billableCount)` · `비용(원, 스냅샷)` · `요청ID`.
- **속성 필터**(URL 상태 유지): 제품·기간·상태. tabular-nums.
- 상태는 텍스트+아이콘 병기. 빈/제로결과/로딩/에러 상태 구분.

### 4.7 `/dashboard/billing` 크레딧
- 상단: 현재 잔액(원, 큰 숫자) + [충전 신청].
- 거래 원장 Collection: `시각` · `유형(충전/과금/환불)` · `금액(±원)` · `제품` · `메모`.
- 충전은 어드민 수동 처리이므로, 고객은 [입금 안내 보기]로 계좌·절차 안내.

### 4.8 `/dashboard/apply` 사용신청 폼 (짧은 Form)
- 필드: 대상 제품, 연락처, 예상 사용량, 용도. 기본값·짧게.
- 제출 → `AccessRequest` 저장 + **Teams 웹훅**(신청자·제품·예상량) + 확인 flashbar.
- 무료 소진 후 402 응답에서 이 폼으로 유도.

---

## 5. 어드민 상세 (`/admin` — design.md 준수)

공통 셸: `AdminAppShell`(top nav: 제품 아이덴티티/프로필 · side nav: 서비스 구조 · flashbar · main · help/split panel). 모든 페이지는 `design.md` 페이지 템플릿(Collection/Details/Form/Dashboard) 중 하나로 분류.

### 5.1 `/admin` 대시보드 (Dashboard 템플릿)
- 요약: 총 유저·이번 달 매출(원)·총 호출·**대기 중 사용신청 수**·오류율.
- 각 아이템 → 해당 컬렉션으로 라우팅(대기신청→/admin/requests 등). 워크플로 페이지化 금지.

### 5.2 `/admin/products` 프로덕트 (Collection + Details/Edit Form)
- 컬럼: `slug(식별)` · `이름` · `상태(active/beta/deprecated)` · `가격(원)` · `단위(call/image/page)` · `무료쿼터` · `수정일` · 액션.
- 헤더 액션: [프로덕트 생성]. 행: 편집·상태토글. tabular-nums로 가격.
- 편집 폼(짧게): 가격·단위·무료쿼터·processorUrl·상태. **가격 변경 시 "과거 호출은 스냅샷 가격 유지" 안내(help)**.
- 상세: 설정 탭 + 최근 사용/매출 미리보기.

### 5.3 `/admin/users` 유저 (Collection) + `/admin/users/[id]` (Details)
- 컬렉션 컬럼: `이메일(식별)` · `role` · `잔액(원)` · `무료사용(freeUsed/quota)` · `최근 호출량` · `가입일` · 액션.
- 속성 필터: role·잔액대·활동. 
- 상세: Entitlement(제품별 접근·freeUsed) · 거래이력 · **[수동 충전] 액션**(원 금액 + 메모 → CreditTx topup, 위험 확인·flashbar 피드백) · 키 목록.

### 5.4 `/admin/credits` 거래 원장 (Collection)
- 컬럼: `시각` · `유저` · `유형(topup/charge/refund)` · `금액(±원)` · `제품` · `단가스냅샷` · `처리자(adminId)` · `메모`.
- 상단 액션: [수동 충전](유저 검색→금액). 필터: 유형·기간·유저. 감사용 절대시각.

### 5.5 `/admin/requests` 사용신청 (Collection + Split Panel)
- 컬럼: `신청일` · `유저/연락처` · `제품` · `예상량` · `상태(new/contacted/approved/rejected)` · 액션.
- Split panel: 신청 상세 + 상태 변경 + [해당 유저 충전으로 이동].
- 신규 신청은 Teams로도 도착 → 여기서 상태 관리·후속.

### 5.6 `/admin/comarketing` 코마케팅 매핑 (Collection + Import) — **전역 적용**
- 컬럼: `약가코드(식별, mono)` · `원 제약사(originalName)` · `표기 제약사(displayName)` · `상태(active)` · `수정일/수정자` · 액션.
- 헤더 액션: [매핑 추가] · **[CSV 임포트]**(수십~수백 코드 벌크) · [CSV 내보내기].
- 인라인 편집(고빈도 속성) 지원. 비활성 토글로 계약 종료 반영.
- 전역 스코프(O4 확정) — 모든 고객 동일 표기. 변경은 이후 호출부터 적용(과거 로그는 스냅샷 유지).

### 5.7 `/admin/usage` 호출이력/정산 (Collection, BigQuery)
- 컬럼: `시각` · `유저` · `제품` · `상태` · `건수` · `비용(원)` · `지연(ms)` · `토큰` · `표기적용(displayNames)`.
- 필터: 제품·유저·기간·상태. **월별·제품별 정산 집계 뷰** + [내보내기](CSV).
- 차트(선택): 제품별 일별 호출/매출 — drill-down은 표로. series ≤8.

---

## 6. 공유 프리미티브 매핑 (design.md 그대로)

| 화면 요소 | 프리미티브 |
|---|---|
| 앱 셸 | `AdminAppShell` |
| 페이지 헤더 | `AdminPageHeader` |
| 컬렉션(유저·프로덕트·신청·코마케팅·이력·원장) | `AdminCollection` + `AdminTable` + 페이지네이션/프리퍼런스 |
| 필터 | `AdminPropertyFilter` (URL 상태 유지) |
| 모바일 | `AdminMobileCollectionCards` |
| 상세/충전/신청 | `AdminSplitPanel` / drawer |
| 상태 | `AdminStatusIndicator` (텍스트+아이콘, 색 단독 금지) |
| 결과·에러 | `AdminFlashbar` |
| 폼(프로덕트·충전·매핑) | `AdminFormSection` + `AdminAdvancedSection` |
| 빈 상태 | `AdminEmptyState` (복구 액션 포함) |

---

## 7. 상태 어휘 (전 화면 공통)

- `success`: 완료·활성·정상 (충전 완료, 프로덕트 active, 호출 ok)
- `info`: 진행·관찰 (처리 중, 신규 신청)
- `warning`: 검토 필요 (잔액 부족 임박, degraded, 신청 대기)
- `error`: 실패·차단 (호출 fail, 결제 불가/402, 비인가)
- `neutral`: 미설정·비활성 (deprecated 프로덕트, 폐기 키)

---

## 8. 반응형 · 접근성 · 카피

- 데스크톱 표 → 모바일 **키-값 카드**로 전환(압축 금지). 식별·상태·시각·핵심 액션 유지, 나머지 확장.
- 오버레이(행 액션·필터·내보내기)는 **포털 렌더**(Radix Portal), `details`+absolute 금지.
- 숫자·금액·날짜·ID는 `tabular-nums`/monospace.
- 카피: 한국어 간결·능동·현재형. 헤더는 리소스/작업명, 설명은 "여기서 뭘 하나" 한 줄. 긴 설명은 help 패널.
- 다국어(한/영/일) 메시지 동시 갱신.

---

## 9. 구축 순서 (design.md Migration Plan 정합)

1. **프리미티브 스켈레톤**: `AdminAppShell`·`AdminCollection`·`AdminTable`·`AdminStatusIndicator`·`AdminFlashbar`·`AdminEmptyState`·모바일 카드 + 반응형 표↔카드 규칙 1회 정의.
2. **인증 게이트**: NextAuth Google(hd=nadoomodoo.com) + role 미들웨어(`/admin`).
3. **고빈도 어드민**: Products → Users(+수동충전) → Requests → Comarketing → Usage/정산.
4. **고객 셀프서브**: 랜딩 카탈로그 → dashboard(keys·usage·billing·apply).
5. **QA**: 데스크톱/모바일 스크린샷, 오버플로·오버레이 클리핑 점검, 상태/빈/에러 상태 검증.
