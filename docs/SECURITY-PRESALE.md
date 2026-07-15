# 판매 전 보안 점검 (Pre-sale Security Checklist)

최종 점검: 2026-07-16.

## 요약

리포지토리 **git 히스토리·추적 파일 전체에 실제 자격증명 유출 없음**. 판매를 위한 히스토리 재작성(filter-repo 등)은 **불필요**. 아래는 점검 근거와 운영 권고.

## 자격증명 노출 점검 ✅

| 항목 | 결과 |
|---|---|
| 추적 중 민감 파일 | `.env.example`(플레이스홀더)만 — 실제 `.env`/`vertex.txt`/키 파일 없음 |
| 히스토리에 추가된 민감 파일 | 없음 (`.env.example` 외) |
| 개인키 (`BEGIN PRIVATE KEY`) | 실 키 없음 — `.env.example` 은 `...` 스켈레톤 |
| 서비스계정 JSON (`private_key`/`client_email`) | 실값 없음 |
| API 키 (`pk_live_`, `AIza`, `AKIA`) | 없음 |
| 웹훅 URL (Teams `webhook.office.com` / Slack) | 없음 |
| 소스 하드코딩 비밀 | 없음 — `infra/index.ts` 는 Pulumi 시크릿 참조(`${dbPassword}`), docs 는 로컬 dev 자리표시자(`app:app@localhost`) |

`.gitignore` 커버: `.env`, `.env.*`(단 `.env.example` 예외), `vertex.txt`, `*.key`, `*.pem`, `credentials*.json`, `service-account*.json`, `edi-data/`.

## 비밀 관리 원칙 (현행)

- **운영 비밀은 Secret Manager**: `database-url`, `auth-secret`, `google-oauth-client-secret`, `teams-webhook-url`, `vertex-credentials`, `demo-api-key`. Cloud Run 에 `--set-secrets`/`--update-secrets` 로 주입, 이미지·코드에 미포함.
- **API 키**: SHA-256 해시만 저장(`ApiKey.keyHash`), 평문은 발급 시 1회만 노출.
- **고객 비밀번호**: scrypt 해시.
- **처방전 이미지(PII)**: 무저장(stateless) 처리, 결과만 GCS 30일 TTL. 공개 데모 샘플로도 사용 금지.

## 운영 권고 (판매 전/후)

1. **로테이션(권장, git 위생 목적은 아님)**: `vertex.txt`(작업트리 미추적)와 Secret Manager 의 `vertex-credentials` 는 개발 과정에서 로컬·공유됐을 수 있으므로, 판매 개시 전 서비스계정 키를 1회 재발급하고 Secret 갱신 권장. (유출 이력이 없으므로 필수는 아님.)
2. **국외이전 고지**: Vertex AI `global` 리전 사용 → 개인정보 국외이전을 위수탁계약/약관에 명시(진행 중).
3. **최소권한 확인**: `api-run`(게이트웨이)·`vertex-ocr`(프로세서)·`portal-run` SA 의 IAM 이 필요한 역할로만 제한됐는지 주기 점검.
4. **약가/제약사 마스터 데이터 이용허락 범위** — 판매 전 별도 확인 필요(비보안 항목이나 판매 게이트). [PLATFORM-PLAN.md](PLATFORM-PLAN.md) 참고.

## 재점검 방법

```bash
# 추적/히스토리 민감 파일
git ls-files | grep -iE "vertex\.txt|\.env$|\.key$|\.pem$|credential|service-account"
git log --all --name-only --diff-filter=A | grep -iE "vertex\.txt|\.env|\.key|\.pem|credential|service-account"
# 히스토리 콘텐츠(고신호 패턴)
for p in "BEGIN PRIVATE KEY" "private_key" "pk_live_" "webhook.office.com" "AIza" "AKIA"; do
  git grep -Il -e "$p" $(git rev-list --all) | head; done
```
