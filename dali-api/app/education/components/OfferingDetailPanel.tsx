// The catalog's right-hand detail pane: selecting a card in OfferingCatalog
// opens this instead of navigating, so browsing a list of offerings doesn't
// cost a page load each time you want to read one.
//
// The header renders immediately from the card data the grid already holds
// (title, emoji, type, seats, instructors) while the parts that need a query —
// description, session times, whether you can still apply — stream in from the
// offering's own detail route via fetcher.load. That route is the surface's
// existing page (/education/:id or /portal/education/:id, whichever `href`
// names), so there is no second copy of the detail query to keep in sync.
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import {
  TypeBadge,
  MyStatusChip,
  registrationMeta,
} from "./OfferingCard";
import { MetaList } from "~/components/ui/MetaList";
import {
  OfferingTypeTile,
  seatsMeta,
  runsValue,
  type CatalogOffering,
} from "./OfferingCatalog";

// The subset of the detail loaders' payload this pane reads. The member and
// portal routes return supersets of it (isManager / tz respectively), so the
// pane works against either without caring which one answered.
type OfferingDetailData = {
  descriptionHtml: string;
  canApply: boolean;
  myStatus: string | null;
  offering: {
    sessions: {
      id: string;
      sequence: number;
      datetime: string | Date;
      location: string | null;
    }[];
  };
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "sessions", label: "Sessions" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function OfferingDetailPanel({
  offering,
  href,
  onClose,
}: {
  offering: CatalogOffering;
  /** The offering's detail route on this surface — loaded, and linked to. */
  href: string;
  onClose: () => void;
}) {
  const tz = useUserTimeZone();
  const fetcher = useFetcher<OfferingDetailData>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The pane is keyed by offering id in the catalog, so a new selection
  // remounts it and lands back on Overview without an extra reset effect.
  const [tab, setTab] = useState<TabKey>("overview");

  const { load } = fetcher;
  useEffect(() => {
    load(href);
  }, [href, load]);

  // Opening the pane moves focus into it, so keyboard and screen-reader users
  // land on the thing that just appeared rather than staying on the grid.
  useEffect(() => {
    headingRef.current?.focus();
  }, [offering.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const detail = fetcher.data;
  const loading = !detail && fetcher.state === "loading";
  // The card's own status is what the grid was rendered with; the detail route
  // is authoritative once it answers (you may have applied in another tab).
  const myStatus = detail?.myStatus ?? offering.myStatus ?? null;

  return (
    <aside
      aria-label={`${offering.title} details`}
      // Full viewport height on desktop: pinned flush under the shell's 64px
      // (h-16) top bar and filling to the bottom edge (100dvh − 4rem), so the
      // pane spans the whole visible column rather than floating with gaps.
      className="flex min-h-[70dvh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-brand-2 motion-safe:animate-detail-panel lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:min-h-0 lg:w-[27rem] lg:shrink-0"
    >
      {/* Title and the facts that identify the offering stay put; only the tab
          panel below them scrolls, so switching tabs never scrolls the heading
          out from under you. */}
      <header className="relative flex shrink-0 flex-col gap-3 px-5 pt-5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={16} />
        </button>
        <div className="flex items-start gap-3 pr-9">
          <OfferingTypeTile
            type={offering.type}
            iconEmoji={offering.iconEmoji}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="font-heading text-xl font-bold text-foreground outline-none"
            >
              {offering.title}
            </h2>
            <span className="mt-1 flex flex-wrap items-center gap-2">
              <TypeBadge type={offering.type} />
              <MyStatusChip status={myStatus} />
              <span className="text-xs text-muted-foreground">
                {offering.sessionCount} session
                {offering.sessionCount === 1 ? "" : "s"}
              </span>
            </span>
          </div>
        </div>
        <MetaList
          rows={[
            { label: "Runs", value: runsValue(offering, tz), tone: "muted" },
            { label: "Registration", ...registrationMeta(offering, tz) },
            { label: "Seats", ...seatsMeta(offering) },
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
      </header>

      {/* Same tab strip as the course hub (CourseHub.tsx) — a student meets
          this control there too, so it should not be a second design. */}
      <nav
        role="tablist"
        aria-label="Offering details"
        className="mt-4 flex shrink-0 gap-1 border-b border-border px-5"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`offering-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`offering-panel-${t.key}`}
            onClick={() => setTab(t.key)}
            className={cn(
              "whitespace-nowrap px-4 py-2 text-sm font-semibold",
              tab === t.key
                ? "border-b-2 border-accent-coral text-accent-coral"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div
        role="tabpanel"
        id={`offering-panel-${tab}`}
        aria-labelledby={`offering-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-5"
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading details…</p>
        ) : !detail ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load the details.{" "}
            <Link to={href} className="underline">
              Open the full page
            </Link>
            .
          </p>
        ) : tab === "overview" ? (
          detail.descriptionHtml ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: detail.descriptionHtml }}
            />
          ) : (
            <p className="text-sm italic text-muted-foreground">
              No description has been added for this{" "}
              {offering.type === "Workshop" ? "workshop" : "miniseries"} yet.
            </p>
          )
        ) : detail.offering.sessions.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            Session times will be posted here.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {detail.offering.sessions.map((s) => (
              <li key={s.id} className="flex flex-col gap-0.5 px-3 py-2">
                <span className="text-sm font-medium text-foreground">
                  Session {s.sequence}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(s.datetime, tz)}
                </span>
                {s.location && (
                  <span className="text-xs text-muted-foreground">
                    {s.location}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border p-4">
        {myStatus === "Approved" && (
          <Link to={`${href}/hub`} className={buttonClasses("primary", "sm")}>
            Open course hub
          </Link>
        )}
        {detail?.canApply && (
          <Link to={`${href}/apply`} className={buttonClasses("primary", "sm")}>
            {myStatus === "Submitted"
              ? "Edit application"
              : offering.requiresReview
                ? "Apply"
                : "RSVP"}
          </Link>
        )}
        {/* Withdrawing, and the full description in its own page, stay on the
            detail route — this pane is the browse-and-decide step. */}
        <Link to={href} className={buttonClasses("ghost", "sm")}>
          Open full page
        </Link>
      </div>
    </aside>
  );
}
