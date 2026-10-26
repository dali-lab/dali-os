export const OPEN_IN_DESKTOP_FALLBACK_MS = 1500;

export function desktopOpenUrl(path: string): string {
  return `dalios://open?link=${encodeURIComponent(path)}`;
}

export function currentPagePath(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

/** Returns a cancel function. `onFallback` fires only if the page kept focus and stayed visible. */
export function openInDesktopApp(
  path: string,
  { onFallback, onOpened }: { onFallback: () => void; onOpened?: () => void },
): () => void {
  let settled = false;
  const stop = () => {
    settled = true;
    clearTimeout(timer);
    window.removeEventListener("blur", onLeft);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  const onLeft = () => {
    if (settled) return;
    stop();
    onOpened?.();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") onLeft();
  };
  const timer = setTimeout(() => {
    if (settled) return;
    stop();
    onFallback();
  }, OPEN_IN_DESKTOP_FALLBACK_MS);
  window.addEventListener("blur", onLeft);
  document.addEventListener("visibilitychange", onVisibility);
  window.location.href = desktopOpenUrl(path);
  return stop;
}

const EXCLUDED_EXACT = ["/download", "/logout", "/signup", "/welcome", "/link"];
const EXCLUDED_PREFIXES = [
  "/settings",
  "/login",
  "/auth",
  "/oauth",
  "/partner",
  "/portal",
  "/api",
  "/internal",
];

export function isOpenInDesktopExcluded(pathname: string, search: string): boolean {
  if (EXCLUDED_EXACT.includes(pathname)) return true;
  if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  return new URLSearchParams(search).get("embed") === "1";
}

export const STAY_IN_BROWSER_KEY = "dali_stay_in_browser";

export function stayInBrowserThisTab(): boolean {
  try {
    return window.sessionStorage.getItem(STAY_IN_BROWSER_KEY) === "1";
  } catch {
    return false;
  }
}

export function setStayInBrowserThisTab(): void {
  try {
    window.sessionStorage.setItem(STAY_IN_BROWSER_KEY, "1");
  } catch {
    // sessionStorage blocked: the overlay still closes
  }
}
