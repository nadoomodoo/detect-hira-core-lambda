/**
 * Nadoo API 판매 플랫폼 인프라 (GCP cso-ai)
 *
 * 관리 대상(상태성 리소스): Cloud SQL·BigQuery·Cloud Tasks·GCS·Secret Manager·런타임 IAM.
 * 비관리: Cloud Run 컴퓨트(이미지 존재 후 CI/CD 배포), 프로젝트/결제/부트스트랩 SA(gcloud).
 *
 * 실행:
 *   pulumi login gs://cso-ai-pulumi-state
 *   pulumi stack init dev
 *   pulumi config set --secret dbPassword <강력한 값>
 *   pulumi up
 */
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const cfg = new pulumi.Config();
const gcpCfg = new pulumi.Config("gcp");
const project = gcpCfg.require("project");           // cso-ai
const region = gcpCfg.require("region");             // asia-northeast3
const dbTier = cfg.get("dbTier") ?? "db-f1-micro";
const dbPassword = cfg.requireSecret("dbPassword");

// ────────────────────────────────────────────────
// GCS — 결과 이미지 버킷 (7일 후 자동 삭제, 서명 URL로만 노출)
// ────────────────────────────────────────────────
const resultsBucket = new gcp.storage.Bucket("results", {
  name: `${project}-results`,
  location: region,
  uniformBucketLevelAccess: true,
  // 처리 이미지 30일 후 자동 삭제 (약관 고지 대상)
  lifecycleRules: [{ action: { type: "Delete" }, condition: { age: 30 } }],
});

// ────────────────────────────────────────────────
// Cloud SQL (Postgres) — 과금 원장 (ACID). public IP + Cloud Run 네이티브 소켓(NAT 불필요)
// ────────────────────────────────────────────────
const sql = new gcp.sql.DatabaseInstance("platform-db", {
  region,
  databaseVersion: "POSTGRES_15",
  settings: {
    tier: dbTier,
    availabilityType: "ZONAL",
    ipConfiguration: { ipv4Enabled: true },
    backupConfiguration: { enabled: true, pointInTimeRecoveryEnabled: false },
    databaseFlags: [{ name: "max_connections", value: "50" }],
  },
  deletionProtection: true,
});
const db = new gcp.sql.Database("platform", { instance: sql.name, name: "platform" });
const dbUser = new gcp.sql.User("app", { instance: sql.name, name: "app", password: dbPassword });

// Cloud Run 네이티브 소켓용 커넥션 이름 (프리픽스: project:region:instance)
export const sqlConnectionName = sql.connectionName;
export const databaseUrl = pulumi.interpolate`postgresql://app:${dbPassword}@localhost/platform?host=/cloudsql/${sql.connectionName}`;

// ────────────────────────────────────────────────
// BigQuery — 호출이력 (일 파티션 + 프로덕트/유저 클러스터)
// ────────────────────────────────────────────────
const dataset = new gcp.bigquery.Dataset("platform", {
  datasetId: "platform",
  location: region,
});
const callLog = new gcp.bigquery.Table("api_call_log", {
  datasetId: dataset.datasetId,
  tableId: "api_call_log",
  deletionProtection: false,
  timePartitioning: { type: "DAY", field: "ts" },
  clusterings: ["product_id", "user_id"],
  schema: JSON.stringify([
    { name: "ts", type: "TIMESTAMP", mode: "REQUIRED" },
    { name: "request_id", type: "STRING", mode: "REQUIRED" },
    { name: "user_id", type: "STRING", mode: "REQUIRED" },
    { name: "product_id", type: "STRING", mode: "REQUIRED" },
    { name: "api_key_prefix", type: "STRING" },
    { name: "status", type: "STRING", mode: "REQUIRED" },
    { name: "billable_count", type: "INT64", mode: "REQUIRED" },
    { name: "cost_krw", type: "INT64", mode: "REQUIRED" },
    { name: "free_used", type: "BOOL" },
    { name: "latency_ms", type: "INT64" },
    { name: "tokens_in", type: "INT64" },
    { name: "tokens_out", type: "INT64" },
    { name: "display_names", type: "STRING", mode: "REPEATED" },
    { name: "error_code", type: "STRING" },
    { name: "rotation", type: "INT64" },
  ]),
});

// ────────────────────────────────────────────────
// Cloud Tasks — 벌크 큐 (dispatch rate로 Vertex QPS 상한)
// ────────────────────────────────────────────────
const hiraQueue = new gcp.cloudtasks.Queue("hira-detect", {
  location: region,
  rateLimits: { maxDispatchesPerSecond: 5, maxConcurrentDispatches: 10 },
  retryConfig: { maxAttempts: 3, minBackoff: "5s", maxBackoff: "60s" },
});

// ────────────────────────────────────────────────
// Secret Manager — 값은 배포 시 주입(빈 시크릿만 정의)
// ────────────────────────────────────────────────
const secretIds = [
  "database-url",
  "auth-secret", // 세션 서명 키 (자체 이메일/암호 + 어드민 Google 공통)
  "google-oauth-client-secret", // 어드민 Google OpenID 용
  "teams-webhook-url",
  "vertex-credentials",
];
const secrets: Record<string, gcp.secretmanager.Secret> = {};
secretIds.forEach((id) => {
  secrets[id] = new gcp.secretmanager.Secret(id, {
    secretId: id,
    replication: { auto: {} },
  });
});

// database-url: Cloud SQL 커넥션 문자열로 채움 (앱이 바로 사용)
new gcp.secretmanager.SecretVersion("database-url-v1", {
  secret: secrets["database-url"].id,
  secretData: databaseUrl,
});

// teams-webhook-url: config 시크릿(KMS 암호화)에서 주입
const teamsWebhookUrl = cfg.getSecret("teamsWebhookUrl");
if (teamsWebhookUrl) {
  new gcp.secretmanager.SecretVersion("teams-webhook-url-v1", {
    secret: secrets["teams-webhook-url"].id,
    secretData: teamsWebhookUrl,
  });
}

// auth-secret: 세션 서명 키 (임의 생성값 주입)
const authSecret = cfg.getSecret("authSecret");
if (authSecret) {
  new gcp.secretmanager.SecretVersion("auth-secret-v1", {
    secret: secrets["auth-secret"].id,
    secretData: authSecret,
  });
}

// google-oauth-client-secret: 어드민 Google OpenID 용
const googleOAuthClientSecret = cfg.getSecret("googleOAuthClientSecret");
if (googleOAuthClientSecret) {
  new gcp.secretmanager.SecretVersion("google-oauth-client-secret-v1", {
    secret: secrets["google-oauth-client-secret"].id,
    secretData: googleOAuthClientSecret,
  });
}

// vertex-credentials: Vertex(Gemini) 호출용 SA JSON (prod-ai-model, A안)
const vertexCredentials = cfg.getSecret("vertexCredentials");
if (vertexCredentials) {
  new gcp.secretmanager.SecretVersion("vertex-credentials-v1", {
    secret: secrets["vertex-credentials"].id,
    secretData: vertexCredentials,
  });
}

// Google OAuth Client ID (비밀 아님 — 앱 config/env 로 전달)
export const googleOAuthClientId = cfg.get("googleOAuthClientId");

// 웹 도메인 (Cloud Run 도메인 매핑 · OAuth 리디렉트 · 랜딩)
export const webDomain = cfg.get("webDomain");

// ────────────────────────────────────────────────
// 런타임 서비스 계정 (Cloud Run 서비스별, 최소권한)
//   vertex-ocr@ 는 gcloud 부트스트랩으로 이미 생성됨 → 참조만.
// ────────────────────────────────────────────────
const apiSa = new gcp.serviceaccount.Account("api-sa", {
  accountId: "api-run",
  displayName: "api Cloud Run runtime",
});
const portalSa = new gcp.serviceaccount.Account("portal-sa", {
  accountId: "portal-run",
  displayName: "portal Cloud Run runtime",
});
const vertexOcrSaEmail = `vertex-ocr@${project}.iam.gserviceaccount.com`;

// api-sa: SQL client · BQ dataEditor · Tasks enqueuer · Secret accessor
const apiRoles = [
  "roles/cloudsql.client",
  "roles/bigquery.dataEditor",
  "roles/bigquery.jobUser",
  "roles/cloudtasks.enqueuer",
  "roles/secretmanager.secretAccessor",
];
apiRoles.forEach(
  (role, i) =>
    new gcp.projects.IAMMember(`api-${i}`, {
      project,
      role,
      member: pulumi.interpolate`serviceAccount:${apiSa.email}`,
    }),
);
// api-sa: 결과 버킷 오브젝트 관리
new gcp.storage.BucketIAMMember("api-results", {
  bucket: resultsBucket.name,
  role: "roles/storage.objectAdmin",
  member: pulumi.interpolate`serviceAccount:${apiSa.email}`,
});
// api-sa(게이트웨이) → processor-hira 프록시 호출 (run.invoker)
new gcp.cloudrunv2.ServiceIamMember("api-invoke-processor", {
  project,
  location: region,
  name: "processor-hira",
  role: "roles/run.invoker",
  member: pulumi.interpolate`serviceAccount:${apiSa.email}`,
});

// portal-sa: SQL client · Secret accessor
["roles/cloudsql.client", "roles/secretmanager.secretAccessor"].forEach(
  (role, i) =>
    new gcp.projects.IAMMember(`portal-${i}`, {
      project,
      role,
      member: pulumi.interpolate`serviceAccount:${portalSa.email}`,
    }),
);

// vertex-ocr(processor-hira): SQL read · 결과 버킷 쓰기 (aiplatform.user 는 부트스트랩에서 부여됨)
new gcp.projects.IAMMember("vertex-sql", {
  project,
  role: "roles/cloudsql.client",
  member: `serviceAccount:${vertexOcrSaEmail}`,
});
new gcp.storage.BucketIAMMember("vertex-results", {
  bucket: resultsBucket.name,
  role: "roles/storage.objectAdmin",
  member: `serviceAccount:${vertexOcrSaEmail}`,
});
// GCS V4 서명 URL 생성 (키 없이 signBlob) — SA 가 자기 자신에 대해 토큰 생성 가능해야 함
new gcp.serviceaccount.IAMMember("vertex-signblob", {
  serviceAccountId: `projects/${project}/serviceAccounts/${vertexOcrSaEmail}`,
  role: "roles/iam.serviceAccountTokenCreator",
  member: `serviceAccount:${vertexOcrSaEmail}`,
});
// Cloud Run(processor) 시크릿 읽기 — DATABASE_URL·vertex-credentials
new gcp.projects.IAMMember("vertex-secrets", {
  project,
  role: "roles/secretmanager.secretAccessor",
  member: `serviceAccount:${vertexOcrSaEmail}`,
});

// ────────────────────────────────────────────────
// 출력
// ────────────────────────────────────────────────
export const resultsBucketName = resultsBucket.name;
export const bigqueryDataset = dataset.datasetId;
export const bigqueryTable = callLog.tableId;
export const tasksQueue = hiraQueue.name;
export const apiServiceAccount = apiSa.email;
export const portalServiceAccount = portalSa.email;
export const secretNames = secretIds;

// ────────────────────────────────────────────────
// TODO(M0 이후): Cloud Run 서비스 정의 — 컨테이너 이미지가 Artifact Registry 에
// 올라온 뒤 활성화. 예:
//   new gcp.cloudrunv2.Service("processor-hira", { ... serviceAccount: vertexOcrSaEmail,
//     template: { containers: [{ image: `${region}-docker.pkg.dev/${project}/apps/processor-hira:latest` }],
//     scaling: { minInstanceCount: 1 } } })
//   공개 API/랜딩은 allUsers invoker 바인딩(조직정책 ALLOW 확인됨).
// ────────────────────────────────────────────────
