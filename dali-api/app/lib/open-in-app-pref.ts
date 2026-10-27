export const OPEN_IN_APP_COOKIE = "dali_open_in_app";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function parseOpenInAppCookie(cookieString: string): boolean {
  for (const part of cookieString.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k?.trim() === OPEN_IN_APP_COOKIE) return rest.join("=").trim() === "1";
  }
  return false;
}

export function readOpenInAppCookie(): boolean {
  try {
    return parseOpenInAppCookie(document.cookie);
  } catch {
    return false;
  }
}

export function writeOpenInAppCookie(on: boolean): void {
  try {
    document.cookie = `${OPEN_IN_APP_COOKIE}=${on ? "1" : "0"}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  } catch {
    // cookies blocked: the toggle just doesn't persist
  }
}
