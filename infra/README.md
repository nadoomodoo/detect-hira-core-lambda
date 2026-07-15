# @platform/infra — Pulumi (TypeScript) IaC

GCP `cso-ai` 프로젝트의 상태성 인프라(Cloud SQL·BigQuery·Cloud Tasks·GCS·Secret·IAM).

## 사전 준비 (1회)

```bash
# 1) Pulumi CLI 설치 (macOS)
brew install pulumi

# 2) GCP ADC 로그인 (Pulumi gcp provider 인증)
gcloud auth application-default login

# 3) 의존성
pnpm install
```

## 배포

```bash
pulumi login gs://cso-ai-pulumi-state      # 상태 백엔드 (버킷 생성됨)
pulumi stack init dev                       # 최초 1회
pulumi config set --secret dbPassword '<강력한 DB 비밀번호>'
pulumi preview                              # 변경 미리보기
pulumi up                                   # 적용
```

## 관리 범위
- 관리: Cloud SQL(Postgres micro), BigQuery(platform.api_call_log), Cloud Tasks(hira-detect),
  GCS(결과 버킷), Secret Manager(빈 시크릿), 런타임 SA + IAM.
- 비관리: Cloud Run 컴퓨트(이미지 배포 후 CI/CD), 프로젝트/결제/부트스트랩 SA(gcloud).

## 부트스트랩 상태 (2026-07-15 완료)
프로젝트 결제·API·`deployer`/`vertex-ocr` SA·Artifact Registry(`apps`)·상태 버킷은
gcloud로 이미 생성됨. 상세는 [../docs/IMPLEMENTATION-PLAN.md](../docs/IMPLEMENTATION-PLAN.md) §12.1.
