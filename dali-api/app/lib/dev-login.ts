export function isDevLoginEnabled(): boolean {
  const env = process.env.NODE_ENV;
  if (env === "development" || env === "test") return true;
  return process.env.ENABLE_DEV_LOGIN === "true";
}
