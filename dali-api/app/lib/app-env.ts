export type AppEnv = 'dev' | 'staging' | 'prod'

// Two parallel "environment" axes exist on purpose:
//  - NODE_ENV → Node-runtime concerns only (dev-server module caching in db.ts,
//    the fail-closed dev-login allowlist in lib/dev-login.ts).
//  - getAppEnv() → app-level feature gates (cookie Secure, CSP/HSTS, etc.);
//    Fly app name → 'dev'|'staging'|'prod', DALI_APP_ENV overrides.
// On Fly.io, staging is NODE_ENV=production AND getAppEnv()==='staging'.
export function getAppEnv(): AppEnv {
  const override = process.env.DALI_APP_ENV
  if (override === 'dev' || override === 'staging' || override === 'prod') {
    return override
  }
  switch (process.env.FLY_APP_NAME) {
    case 'dali-api-prod':
      return 'prod'
    case 'dali-api-staging':
      return 'staging'
    default:
      return 'dev'
  }
}

export const DARTMOUTH_EMAIL_DOMAIN = 'dartmouth.edu'

// NOTE: google-workspace.ts duplicate; new canonical home, adoption later.
// Hardcoded (no env override) so this module stays safe to import from client
// components — top-level `process.env` reads crash the browser bundle. If we
// ever need the env override, move it into a function or a server-only file.
export const WORKSPACE_DOMAIN = 'dali.dartmouth.edu'

export const APPLICATIONS_FROM_EMAIL = 'applications@dali.dartmouth.edu'

export const PARTNERS_FROM_EMAIL = 'partners@dali.dartmouth.edu'

// Where non-prod mail goes instead of its real recipient. Lives here, not in a
// transport, because there is more than one transport: the transactional sender
// (lib/gmail.ts) and the Email tab's per-account mailbox
// (app/email/lib/gmail-mailbox.server.ts) both have to honour it, and a staging
// deploy runs against a restore of the prod DB, so every address it holds is a
// real person's.
export const STAGING_REDIRECT_EMAIL = 'systems@dali.dartmouth.edu'

export const APPLICATIONS_FROM_NAME = 'DALI Lab'

export function getApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3001'
}

// Our OAuth issuer identifier, shared by the RFC 8414 metadata `issuer`, the
// RFC 9728 `authorization_servers` entry, and the RFC 9207 `iss` parameter we
// put on every authorization response. MCP clients compare `iss` to the
// metadata `issuer` by exact string and normalize neither trailing slashes nor
// case, so all three must come from here or a mismatch silently fails the
// whole flow. Falls back to the request origin (not getApiBaseUrl's localhost
// default) so PR preview apps, which set only API_BASE_URL, still self-describe
// correctly.
export function getOAuthIssuer(request: Request): string {
  const base =
    process.env.API_BASE_URL ?? new URL(request.url).origin
  return base.replace(/\/+$/, '')
}

export function getFrontendUrl(): string {
  // Single full-stack server: in deployed environments the frontend origin IS
  // the API origin, so fall back to it — PR preview apps set only
  // API_BASE_URL, and without this their emailed links pointed at localhost.
  // FRONTEND_URL stays as the override for split local setups.
  return (
    process.env.FRONTEND_URL ??
    process.env.API_BASE_URL ??
    'http://localhost:5173'
  )
}

export function getCasBaseUrl(): string {
  return process.env.CAS_BASE_URL ?? 'https://login.dartmouth.edu/cas'
}
