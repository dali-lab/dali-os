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
