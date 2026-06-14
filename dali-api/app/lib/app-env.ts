export type AppEnv = 'dev' | 'staging' | 'prod'

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

export const APPLICATIONS_FROM_NAME = 'DALI Lab'

export function getApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3001'
}

export function getFrontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173'
}

export function getCasBaseUrl(): string {
  return process.env.CAS_BASE_URL ?? 'https://login.dartmouth.edu/cas'
}
