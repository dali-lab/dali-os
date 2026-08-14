// Recognises a speculative navigation request so loaders can skip the writes
// they'd otherwise do "because the user opened this page" — they didn't.
//
// React Router's prefetching (<Link prefetch>, <PrefetchPageLinks>) renders
// <link rel="prefetch">, and the browser tags the request it makes: Chromium
// sends Sec-Purpose (Purpose on older builds), Firefox sends X-moz. WebKit has
// no link prefetch at all, so it simply never sends one of these — the guard is
// a no-op there rather than wrong.
export function isPrefetchRequest(request: Request): boolean {
  const headers = request.headers;
  const secPurpose = headers.get("sec-purpose") ?? "";
  // Sec-Purpose is a token list — "prefetch", or "prefetch;prerender".
  if (secPurpose.toLowerCase().includes("prefetch")) return true;
  if ((headers.get("purpose") ?? "").toLowerCase() === "prefetch") return true;
  return (headers.get("x-moz") ?? "").toLowerCase() === "prefetch";
}
