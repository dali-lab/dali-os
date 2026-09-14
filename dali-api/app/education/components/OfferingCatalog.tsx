// The public offering catalog: a project-hub-style grid of cover cards with a
// search field and a type filter. Shared by the member (/education) and portal
// (/portal/education) surfaces so the two stay identical. The dense admin card
// (OfferingCard, with its ⋯ menu and review counts) is unchanged — this is the
// browse-and-apply view only.
//
// Styled against the *semantic* tokens (bg-card / text-foreground / border-
// border), not the os-* palette: the member surface renders inside `.os-shell`
// (which remaps those tokens to the os palette) while the applicant portal does
// not, so semantic tokens are what render correctly on both. The gradient cover
// and card structure are what carry the project-hub look across the theme line.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { OfferingDetailPanel } from "./OfferingDetailPanel";
import { SearchInput } from "~/components/ui/SearchInput";
import { MetaList } from "~/components/ui/MetaList";
import { FilterPill } from "~/components/ui/filter-panel";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import {
  TypeBadge,
  MyStatusChip,
  registrationWindowValue,
  type OfferingCardData,
} from "./OfferingCard";

// The catalog needs the card's display fields plus the caller's own status and
// the dates used to sort past vs. upcoming.
export type CatalogOffering = OfferingCardData & {
  myStatus?: string | null;
  endsAt: string | Date | null;
  closedOutAt: string | Date | null;
};

type TypeFilter = "all" | "Miniseries" | "Workshop";

// Cards hold their size and the row count changes instead: with a 1fr max the
// tracks stretch, so opening the detail pane made every remaining card wider —
// the grid visibly reflowing under the thing you just clicked. Capped tracks
// reflow quietly. Phones keep 1fr so a single column still fills the screen.
const GRID =
  "grid gap-6 grid-cols-[repeat(auto-fill,minmax(260px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(260px,320px))]";

// The coral→green gradient (shared with ProjectCoverImage / project cards),
// with the offering's emoji centered on it — or the title's first letter when
// no emoji is set, so a card never collapses to a bare title.
export function OfferingCover({
  iconEmoji,
  title,
}: {
  iconEmoji: string | null | undefined;
  title: string;
}) {
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="flex h-[150px] w-full items-center justify-center bg-gradient-to-br from-accent-coral/30 via-accent-coral/15 to-accent-green/20 transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
      aria-hidden
    >
      {iconEmoji ? (
        <span className="text-5xl leading-none">{iconEmoji}</span>
      ) : (
        <span className="font-heading text-4xl font-bold text-accent-coral/70">
          {initial}
        </span>
      )}
    </div>
  );
}

export function seatsLabel(offering: {
  capacity: number;
  approvedCount: number;
}): string {
  const left = Math.max(0, offering.capacity - offering.approvedCount);
  return left > 0
    ? `${left} of ${offering.capacity} left`
    : "Full — waitlist open";
}

export function OfferingCatalogCard({
  offering,
  to,
  myStatus,
  selected,
  onSelect,
}: {
  offering: CatalogOffering;
  to: string;
  myStatus?: string | null;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const tz = useUserTimeZone();
  return (
    // Cover-led card that lifts on hover, the cover scaling on a slower curve
    // than the frame — the project-card choreography, on semantic tokens.
    // Still a real link even when it opens the side pane: ⌘-click, middle-click
    // and "open in new tab" have to keep reaching the offering's own page.
    <Link
      to={to}
      aria-current={selected ? "true" : undefined}
      onClick={(e) => {
        if (!onSelect) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
          return;
        e.preventDefault();
        onSelect();
      }}
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-brand-1 transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.8,0.3,1)] hover:shadow-brand-2 hover:duration-200 motion-safe:hover:-translate-y-1 ${
        selected
          ? "border-accent-coral ring-2 ring-accent-coral/40"
          : "border-border"
      }`}
    >
      <div className="relative overflow-hidden">
        <OfferingCover iconEmoji={offering.iconEmoji} title={offering.title} />
        {myStatus ? (
          <div className="absolute right-3 top-3">
            <MyStatusChip status={myStatus} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-[17px]">
        <span className="truncate text-lg font-semibold text-foreground">
          {offering.title}
        </span>
        <span className="flex items-center gap-2">
          <TypeBadge type={offering.type} />
          <span className="text-xs text-muted-foreground">
            {offering.sessionCount} session{offering.sessionCount === 1 ? "" : "s"}
          </span>
        </span>
        <MetaList
          className="mt-auto pt-1"
          rows={[
            { label: "Registration", value: registrationWindowValue(offering, tz) },
            { label: "Seats", value: seatsLabel(offering) },
          ]}
        />
      </div>
    </Link>
  );
}

export function OfferingCatalog({
  offerings,
  to,
}: {
  offerings: CatalogOffering[];
  /** Maps an offering id to its detail route (differs member vs. portal). */
  to: (offeringId: string) => string;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const now = Date.now();

  const { upcoming, past } = useMemo(() => {
    const isPast = (o: CatalogOffering) =>
      o.closedOutAt != null ||
      (o.endsAt != null && new Date(o.endsAt).getTime() < now);
    return {
      // Enrolled offerings live in the "My courses" dashboard above the catalog;
      // this grid is for offerings the viewer can still apply to or RSVP for.
      upcoming: offerings.filter((o) => !isPast(o) && o.myStatus !== "Approved"),
      past: offerings.filter(isPast),
    };
  }, [offerings, now]);

  const q = query.trim().toLowerCase();
  const shown = upcoming.filter(
    (o) =>
      (typeFilter === "all" || o.type === typeFilter) &&
      (q === "" || o.title.toLowerCase().includes(q)),
  );

  // Selecting a card opens the detail pane beside the grid instead of
  // navigating. A selection that the current search/filter has hidden is
  // dropped, so the pane never describes a card you can no longer see.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    [...shown, ...past].find((o) => o.id === selectedId) ?? null;

  return (
    <section className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
      {/* The grid column. On a phone there is no room for two panes, so the
          open pane replaces the list rather than shrinking beside it. */}
      <div
        className={`min-w-0 flex-1 flex-col gap-5 ${selected ? "hidden lg:flex" : "flex"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search offerings…"
            containerClassName="flex-1 min-w-[240px] max-w-[420px]"
          />
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by type">
            {/* Sized and toned to sit beside the search field as one filter
                bar — see FilterPill's "md" size. */}
            <FilterPill
              os={false}
              size="md"
              tone="blue"
              selected={typeFilter === "all"}
              onClick={() => setTypeFilter("all")}
            >
              All
            </FilterPill>
            <FilterPill
              os={false}
              size="md"
              tone="blue"
              selected={typeFilter === "Miniseries"}
              onClick={() => setTypeFilter("Miniseries")}
            >
              Miniseries
            </FilterPill>
            <FilterPill
              os={false}
              size="md"
              tone="blue"
              selected={typeFilter === "Workshop"}
              onClick={() => setTypeFilter("Workshop")}
            >
              Workshops
            </FilterPill>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <p className="font-heading font-semibold text-foreground">
              {upcoming.length === 0 ? "Nothing open right now" : "No offerings match"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {upcoming.length === 0
                ? "Upcoming miniseries and workshops will show up here."
                : "Try a different search or filter."}
            </p>
          </div>
        ) : (
          <div className={GRID}>
            {shown.map((o) => (
              <OfferingCatalogCard
                key={o.id}
                offering={o}
                to={to(o.id)}
                myStatus={o.myStatus}
                selected={o.id === selectedId}
                onSelect={() => setSelectedId(o.id)}
              />
            ))}
          </div>
        )}

        {past.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Past offerings ({past.length})
            </summary>
            <div className={`mt-3 ${GRID} opacity-80`}>
              {past.map((o) => (
                <OfferingCatalogCard
                  key={o.id}
                  offering={o}
                  to={to(o.id)}
                  myStatus={o.myStatus}
                  selected={o.id === selectedId}
                  onSelect={() => setSelectedId(o.id)}
                />
              ))}
            </div>
          </details>
        )}
      </div>

      {selected && (
        <OfferingDetailPanel
          // Keyed so switching cards remounts the pane: the fetch, the scroll
          // position and the focus move all restart for the new offering.
          key={selected.id}
          offering={selected}
          href={to(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  );
}
