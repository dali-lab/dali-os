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
import { Award, GraduationCap, Presentation } from "lucide-react";
import { OFFERING_TYPE_TINT, type OfferingType } from "~/education/lib/offering-type";
import { OfferingDetailPanel } from "./OfferingDetailPanel";
import { SearchInput } from "~/components/ui/SearchInput";
import { MetaList, type MetaTone } from "~/components/ui/MetaList";
import { FilterPill } from "~/components/ui/filter-panel";
import { cn } from "~/lib/cn";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import {
  TypeBadge,
  MyStatusChip,
  registrationMeta,
  type OfferingCardData,
} from "./OfferingCard";

// The catalog needs the card's display fields plus the caller's own status and
// the dates used to sort past vs. upcoming.
export type CatalogOffering = OfferingCardData & {
  myStatus?: string | null;
  endsAt: string | Date | null;
  closedOutAt: string | Date | null;
};

type TypeFilter = "all" | OfferingType;

// Cards hold their size and the row count changes instead: with a 1fr max the
// tracks stretch, so opening the detail pane made every remaining card wider —
// the grid visibly reflowing under the thing you just clicked. Capped tracks
// reflow quietly. Phones keep 1fr so a single column still fills the screen.
const GRID =
  "grid gap-6 grid-cols-[repeat(auto-fill,minmax(260px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(260px,320px))]";

// A small type-tinted tile carrying the offering's emoji — or a type glyph
// (mortarboard for a miniseries, award for a fellowship, easel for a workshop)
// when none is set, since
// a real icon reads as intentional where a bare initial reads as a placeholder.
// The tint is the offering's identity (OFFERING_TYPE_TINT), the same split the
// TypeBadge uses. Replaces the old full-bleed gradient cover,
// whose one pastel wash made every offering look identical.
const TYPE_GLYPH = {
  Miniseries: GraduationCap,
  Fellowship: Award,
  Workshop: Presentation,
} satisfies Record<OfferingType, unknown>;

export function OfferingTypeTile({
  type,
  iconEmoji,
  size = "md",
}: {
  type: OfferingCardData["type"];
  iconEmoji?: string | null;
  size?: "md" | "lg";
}) {
  const Glyph = TYPE_GLYPH[type];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center leading-none",
        size === "lg" ? "h-14 w-14 rounded-2xl text-3xl" : "h-11 w-11 rounded-xl text-2xl",
        OFFERING_TYPE_TINT[type],
      )}
      aria-hidden
    >
      {iconEmoji ? (
        <span>{iconEmoji}</span>
      ) : (
        <Glyph className={size === "lg" ? "h-7 w-7" : "h-5 w-5"} />
      )}
    </div>
  );
}

// The run window as a meta value: the offering's own dates, or a plain "Dates
// TBD" before they're set so the row never reads as a blank.
export function runsValue(
  offering: Pick<OfferingCardData, "startsAt" | "endsAt">,
  tz: string,
): string {
  return offering.startsAt && offering.endsAt
    ? `${formatDateShort(offering.startsAt, tz)} – ${formatDateShort(offering.endsAt, tz)}`
    : "Dates TBD";
}

// Seats as a labelled meta row with urgency: a full offering points at its
// waitlist and a nearly-full one (a quarter of seats or fewer) turns coral, so
// scarcity reads at a glance — while a small-but-open workshop (e.g. 2 of 2)
// stays neutral, since every seat is still available.
export function seatsMeta(offering: {
  capacity: number;
  approvedCount: number;
}): { value: string; tone: MetaTone } {
  const left = Math.max(0, offering.capacity - offering.approvedCount);
  if (left === 0) return { value: "Full — waitlist open", tone: "urgent" };
  const scarce = offering.capacity > 0 && left / offering.capacity <= 0.25;
  return {
    value: `${left} of ${offering.capacity} left`,
    tone: scarce ? "urgent" : "default",
  };
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
  const reg = registrationMeta(offering, tz);
  const seats = seatsMeta(offering);
  return (
    // A flat, info-led card: type tile + title up top, the facts a browser
    // scans for below a hairline, with the dynamic ones (a closing deadline,
    // scarce seats) tinted for urgency. Still a real link even when it opens the
    // side pane, so ⌘-click / middle-click / "open in new tab" keep reaching the
    // offering's own page.
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
      className={cn(
        "group flex flex-col gap-3.5 rounded-2xl border bg-card p-4 shadow-brand-1 transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.2,0.8,0.3,1)] hover:shadow-brand-2 hover:duration-200 motion-safe:hover:-translate-y-0.5",
        selected
          ? "border-accent-coral ring-2 ring-accent-coral/40"
          : "border-border hover:border-accent-coral/40",
      )}
    >
      <div className="flex items-start gap-3">
        <OfferingTypeTile type={offering.type} iconEmoji={offering.iconEmoji} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-base font-bold text-foreground transition-colors group-hover:text-accent-coral">
            {offering.title}
          </h3>
          <span className="mt-0.5 flex items-center gap-2">
            <TypeBadge type={offering.type} />
            <span className="text-xs text-muted-foreground">
              {offering.sessionCount} session{offering.sessionCount === 1 ? "" : "s"}
            </span>
          </span>
        </div>
        {myStatus ? <MyStatusChip status={myStatus} /> : null}
      </div>
      <div className="border-t border-border" />
      <MetaList
        rows={[
          { label: "Runs", value: runsValue(offering, tz), tone: "muted" },
          { label: "Registration", value: reg.value, tone: reg.tone },
          { label: "Seats", value: seats.value, tone: seats.tone },
          ...(offering.instructorNames.length > 0
            ? [
                {
                  label: "Taught by",
                  value: offering.instructorNames.join(", "),
                  tone: "muted" as const,
                },
              ]
            : []),
        ]}
      />
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
  // navigating. Resolved against every offering rather than the filtered
  // `shown`: a type filter or search term that hides the selected card must not
  // take the pane down with it. Deriving it from `shown` closed the pane when
  // you switched filters and then *reopened* it when you switched back, since
  // selectedId was still set — the pane appeared to come back from the dead.
  // The pane closes when it is closed, and only then.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = offerings.find((o) => o.id === selectedId) ?? null;

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
              selected={typeFilter === "Fellowship"}
              onClick={() => setTypeFilter("Fellowship")}
            >
              Fellowships
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
                ? "Upcoming workshops, miniseries, and fellowships will show up here."
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
