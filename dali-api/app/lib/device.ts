/** Client-safe device/platform checks. Must stay free of server-only imports
 *  so it can be pulled into any component bundle. */

/** True on phones and tablets. Excludes UA-flagged mobile devices plus iPads —
 *  iPadOS 13+ reports a "Macintosh" UA, so fall back to touch-point detection to
 *  catch them. Returns false during SSR (no `navigator`). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|BlackBerry|Opera Mini|IEMobile/i.test(ua)) {
    return true;
  }
  return navigator.maxTouchPoints > 1 && /Mac/i.test(ua);
}
