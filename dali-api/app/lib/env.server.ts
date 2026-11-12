import { z } from "zod";
import { getAppEnv } from "~/lib/app-env";
import { logError } from "~/lib/log.server";

const text = z.string();
const url = z.url();
const int = z.string().regex(/^\d+$/);

const shape = {
  DATABASE_URL: url,
  DIRECT_URL: url,
  DATABASE_POOL_MAX: int,
  DATABASE_POOL_MIN: int,
  DATABASE_POOL_IDLE_TIMEOUT_MS: int,
  BETTER_AUTH_SECRET: text,
  GOOGLE_CLIENT_ID: text,
  GOOGLE_CLIENT_SECRET: text,
  DARTMOUTH_API_KEY: text,
  GOOGLE_WORKSPACE_SA_EMAIL: text,
  GOOGLE_WORKSPACE_SA_PRIVATE_KEY: text,
  GOOGLE_WORKSPACE_ADMIN_EMAIL: text,
  GOOGLE_WORKSPACE_DOMAIN: text,
  GMAIL_CLIENT_ID: text,
  GMAIL_CLIENT_SECRET: text,
  ONBOARDING_EMAIL_OVERRIDE: text,
  FRONTEND_URL: url,
  API_BASE_URL: url,
  DALI_APP_ENV: z.enum(["dev", "staging", "prod"]),
  FLY_APP_NAME: text,
  NODE_ENV: text,
  REDIS_URL: url,
  AWS_REGION: text,
  AWS_S3_BUCKET: text,
  AWS_ACCESS_KEY_ID: text,
  AWS_SECRET_ACCESS_KEY: text,
  ZOOM_ACCOUNT_ID: text,
  ZOOM_CLIENT_ID: text,
  ZOOM_CLIENT_SECRET: text,
  CALENDAR_TOKEN_KEY: text,
  DALI_GENERAL_CALENDAR_ICS: url,
  DALI_GENERAL_CALENDAR_ID: text,
  SLACK_SIGNING_SECRET: text,
  SLACK_BOT_TOKEN: text,
  SLACK_ADMIN_TOKEN: text,
  SLACK_TEAM_ID: text,
  SLACK_WORKSPACE_URL: url,
  GITHUB_APP_ID: text,
  GITHUB_APP_INSTALLATION_ID: text,
  GITHUB_APP_PRIVATE_KEY: text,
  GITHUB_ISSUES_REPO: text,
  GITHUB_ORG: text,
  GITHUB_WEBHOOK_SECRET: text,
  JOBS_TICK_SECRET: text,
  NOTIFY_SLACK_DM_OVERRIDE: text,
  DEV_FEATURE_FLAGS: text,
  WALLET_PASS_SECRET: text,
  APPLE_PASS_TYPE_ID: text,
  APPLE_TEAM_ID: text,
  APPLE_PASS_CERT_PEM: text,
  APPLE_PASS_KEY_PEM: text,
  APPLE_PASS_KEY_PASSPHRASE: text,
  APPLE_WWDR_CERT_PEM: text,
  APPLE_PASS_APNS_HOST: text,
  GOOGLE_WALLET_ISSUER_ID: text,
  GOOGLE_WALLET_SA_EMAIL: text,
  GOOGLE_WALLET_SA_PRIVATE_KEY: text,
  ANTHROPIC_API_KEY: text,
  DARTMOUTH_CHAT_API_KEY: text,
  DARTMOUTH_CHAT_BASE_URL: url,
  AI_PROVIDER: z.enum(["anthropic", "dartmouth"]),
  SHOWCASE_API_SECRET: text,
  COLLAB_PORT: int,
  COLLAB_URL: url,
  CSP_ENFORCE: text,
  ADMIN_USER_IDS: text,
  MCP_ALLOWED_REDIRECT_HOSTS: text,
  MCP_ALLOWED_REDIRECT_URIS: text,
  DESKTOP_LATEST_VERSION: text,
  DESKTOP_MIN_VERSION: text,
  DESKTOP_DOWNLOAD_URL: url,
  DESKTOP_NOTES_URL: url,
  DIARIZE_URL: url,
  DIARIZE_SECRET: text,
  INFRA_SECRET_KEY: text,
  INFRA_NEON_API_KEY: text,
  INFRA_PROTECTED_FLY_APPS: text,
  INFRA_PROTECTED_NEON_PROJECTS: text,
  RELEASE_NOTES_REPO: text,
  RELEASE_NOTES_SLACK_CHANNEL_ID: text,
  HIRING_CALENDAR_EMAIL: text,
  FINALIZE_EXTERNAL_OVERRIDE: text,
  CHROMIUM_EXECUTABLE_PATH: text,
} satisfies Record<string, z.ZodType<string>>;

export type EnvName = keyof typeof shape;
export type Env = { [K in EnvName]?: string };

export const REQUIRED_DEPLOYED_ENV = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const satisfies readonly EnvName[];

export const ENV_NAMES = Object.keys(shape) as EnvName[];

type Source = Record<string, string | undefined>;

function inspect(source: Source) {
  const values: Env = {};
  const missing: string[] = [];
  const invalid: string[] = [];
  const deployed = getAppEnv() !== "dev";
  for (const name of ENV_NAMES) {
    const raw = source[name];
    if (raw === undefined || raw === "") {
      if (deployed && (REQUIRED_DEPLOYED_ENV as readonly string[]).includes(name)) missing.push(name);
      continue;
    }
    if (shape[name].safeParse(raw).success) values[name] = raw;
    else invalid.push(name);
  }
  return { values, missing, invalid };
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (process.env.VITEST) return inspect(process.env).values;
  cached ??= inspect(process.env).values;
  return cached;
}

export function resetEnvForTests(): void {
  cached = null;
}

export function checkEnv(source: Source = process.env): { missing: string[]; invalid: string[] } {
  const { missing, invalid } = inspect(source);
  return { missing, invalid };
}

export function warnOnBadEnv(): void {
  const { missing, invalid } = checkEnv();
  if (missing.length === 0 && invalid.length === 0) return;
  const parts = [
    missing.length ? `missing: ${missing.join(", ")}` : "",
    invalid.length ? `invalid: ${invalid.join(", ")}` : "",
  ].filter(Boolean);
  logError("env", new Error(`checkEnv ${parts.join("; ")}`));
}
