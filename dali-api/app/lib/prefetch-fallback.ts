const REUSE_MS = 5 * 60_000; // Chrome's reuse window for rel="prefetch", so WebKit matches browsers.

type Warmed = { at: number; response: Promise<Response | null> };

function dataKey(input: RequestInfo | URL, base: string): string | null {
  const url = new URL(input instanceof Request ? input.url : String(input), base);
  if (url.origin !== new URL(base).origin || !url.pathname.endsWith(".data")) return null;
  return url.pathname + url.search;
}

function prefetchSupported(win: Window): boolean {
  return win.document.createElement("link").relList.supports("prefetch");
}

function dataLinks(node: Node): HTMLLinkElement[] {
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  const links: Element[] = el.tagName === "LINK" ? [el] : [...el.getElementsByTagName("link")];
  return links.filter(
    (l) => l.getAttribute("rel") === "prefetch" && l.getAttribute("as") === "fetch",
  ) as HTMLLinkElement[];
}

/**
 * WebKit ignores rel="prefetch", so React Router's PrefetchPageLinks warm route
 * JS but never loader data there. Fetch those links here and hand each response
 * to the next navigation for that url.
 */
export function installPrefetchFallback(win: Window = window, supported = prefetchSupported(win)) {
  if (supported) return;

  const nativeFetch = win.fetch.bind(win);
  const warmed = new Map<string, Warmed>();
  const isFresh = (entry: Warmed) => Date.now() - entry.at < REUSE_MS;

  const warm = (href: string) => {
    const key = dataKey(href, win.location.href);
    if (!key) return;
    const existing = warmed.get(key);
    if (existing && isFresh(existing)) return;
    for (const [k, entry] of warmed) if (!isFresh(entry)) warmed.delete(k);
    warmed.set(key, {
      at: Date.now(),
      // Purpose, not Sec-Purpose: browsers drop Sec-* headers set from script,
      // and without one isPrefetchRequest counts this warm as a page open.
      response: nativeFetch(href, { headers: { Purpose: "prefetch" } })
        .then(async (res) => {
          // Drain a copy so an unused response doesn't hold a connection open.
          await res.clone().arrayBuffer();
          return res;
        })
        .catch(() => null),
    });
  };

  win.fetch = async (input, init) => {
    const key = dataKey(input, win.location.href);
    if (!key) return nativeFetch(input, init);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method.toUpperCase() !== "GET") {
      warmed.clear();
      return nativeFetch(input, init);
    }
    const hit = warmed.get(key);
    warmed.delete(key);
    if (hit && isFresh(hit)) {
      const res = await hit.response;
      if (res?.ok) return res;
    }
    return nativeFetch(input, init);
  };

  new (win as Window & typeof globalThis).MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        for (const link of dataLinks(node)) warm(link.href);
      }
    }
  }).observe(win.document, { childList: true, subtree: true });
}
