import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { matchesPage } from "~/core/lib/banners";
import type { BannerDTO, BannerEvent } from "~/core/lib/banners.server";
import { BannerOverlay } from "./BannerContent";

export type BannerScope = "open" | "page" | "all";

function record(id: string, event: BannerEvent) {
  void fetch(`/api/banners/${encodeURIComponent(id)}/event`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => {});
}

/**
 * Picks the next banner to open from the viewer's live set: an app-open one
 * when this document first loads, a page one when its page is visited. Each
 * shows at most once per document; frequency and snooze across visits are
 * the server's job.
 */
export function pickBanner(
  live: BannerDTO[],
  scope: BannerScope,
  pathname: string,
  isFirstLoad: boolean,
  shown: ReadonlySet<string>,
): BannerDTO | null {
  return (
    live.find((b) => {
      if (shown.has(b.id)) return false;
      if (b.trigger === "AppOpen") return isFirstLoad && scope !== "page";
      return scope !== "open" && matchesPage(b.triggerPath, pathname);
    }) ?? null
  );
}

export function BannerHost({ scope }: { scope: BannerScope }) {
  const enabled = useFeatureFlag("banners");
  const { pathname } = useLocation();
  const [live, setLive] = useState<BannerDTO[] | null>(null);
  const [active, setActive] = useState<BannerDTO | null>(null);
  const shown = useRef(new Set<string>());
  const firstPath = useRef(pathname);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/banners/active", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { banners: [] }))
      .then((d: { banners?: BannerDTO[] }) => !cancelled && setLive(d.banners ?? []))
      .catch(() => !cancelled && setLive([]));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!live || active) return;
    const next = pickBanner(live, scope, pathname, pathname === firstPath.current, shown.current);
    if (!next) return;
    shown.current.add(next.id);
    record(next.id, "view");
    setActive(next);
  }, [live, active, scope, pathname]);

  if (!active) return null;
  return (
    <BannerOverlay
      banner={active}
      onCta={() => {
        record(active.id, "click");
        setActive(null);
      }}
      onClose={(snoozeToday) => {
        if (snoozeToday) record(active.id, "snooze");
        // Once it's closed, the app-open moment has passed for this document.
        firstPath.current = "";
        setActive(null);
      }}
    />
  );
}
