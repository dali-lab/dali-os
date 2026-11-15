import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Calendar as CalendarIcon, Clock, Repeat, Search, RefreshCw, UsersRound } from "lucide-react";
import { AnchoredCard } from "~/components/ui/floating/AnchoredCard";
import type { CalendarSearchHit } from "~/calendar/lib/search";

// ── Helpers ───────────────────────────────────────────────────────────────


export type SearchResponse = {
  local: CalendarSearchHit[];
  google: CalendarSearchHit[];
  googleError: string | null;
  scope: "near" | "all";
};

// ── CalendarSearchBar ──────────────────────────────────────────────────────

export function CalendarSearchBar({
  anchor,
  rangeStartIso,
  rangeEndIso,
  timezone,
  onClose,
  onSelect,
}: {
  anchor: DOMRect;
  rangeStartIso: string;
  rangeEndIso: string;
  timezone: string;
  onClose: () => void;
  onSelect: (hit: CalendarSearchHit) => void;
}) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"near" | "all">("near");
  const fetcher = useFetcher<SearchResponse>();

  const query = q.trim();
  const hasQuery = query.length >= 2;

  // Debounced load; re-fires when the query or the (widened) scope changes.
  useEffect(() => {
    if (query.length < 2) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams({
        q: query,
        scope,
        rangeStart: rangeStartIso,
        rangeEnd: rangeEndIso,
      });
      fetcher.load(`/api/calendar/search?${params.toString()}`);
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope, rangeStartIso, rangeEndIso]);

  const loading = fetcher.state !== "idle";
  const local = fetcher.data?.local ?? [];
  const google = fetcher.data?.google ?? [];
  const googleError = fetcher.data?.googleError ?? null;
  const settled = hasQuery && !loading && Boolean(fetcher.data);
  const nothing = settled && local.length === 0 && google.length === 0;

  const now = new Date();
  const fmtWhen = (hit: CalendarSearchHit) => {
    const d = new Date(hit.startIso);
    const sameYear =
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(d) ===
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(now);
    const dateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(d);
    if (hit.allDay) return dateStr;
    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
    return `${dateStr} · ${timeStr}`;
  };

  const iconFor = (source: CalendarSearchHit["source"]) =>
    source === "meeting" ? UsersRound : source === "block" ? Clock : CalendarIcon;

  const renderHit = (hit: CalendarSearchHit) => {
    const Icon = iconFor(hit.source);
    return (
      <button
        key={hit.id}
        type="button"
        onClick={() => onSelect(hit)}
        className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{hit.title}</span>
            {hit.recurring && (
              <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Repeats" />
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {fmtWhen(hit)}
            {hit.location ? ` · ${hit.location}` : ""}
          </span>
        </span>
      </button>
    );
  };

  return (
    <AnchoredCard
      anchor={anchor}
      onClose={onClose}
      ariaLabel="Search events"
      className="flex max-h-[70vh] w-[26rem] flex-col overflow-hidden rounded-xl cal-surface"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setScope("near"); // a new query resets to the cheap near window
          }}
          placeholder="Search events…"
          aria-label="Search events"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {loading && <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!hasQuery && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Search your events by title. Your calendar is searched across all time; Google is scoped
            to nearby weeks.
          </p>
        )}
        {nothing && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No events match "{query}".
          </p>
        )}

        {local.length > 0 && (
          <div className="mb-1">
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Your calendar
            </p>
            {local.map(renderHit)}
          </div>
        )}

        {google.length > 0 && (
          <div className="mb-1">
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Google
            </p>
            {google.map(renderHit)}
          </div>
        )}

        {hasQuery && !loading && scope === "near" && (
          <button
            type="button"
            onClick={() => setScope("all")}
            className="mt-0.5 w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-os-accent hover:bg-muted"
          >
            Search all Google calendars →
          </button>
        )}
        {scope === "all" && !loading && (
          <p className="px-2 pt-1 text-[10px] text-muted-foreground">Showing all Google results.</p>
        )}
        {googleError && (
          <p className="px-2 pt-1 text-[11px] text-muted-foreground">Couldn't reach Google.</p>
        )}
      </div>
    </AnchoredCard>
  );
}

// ── WorkingHoursPopover ────────────────────────────────────────────────────
