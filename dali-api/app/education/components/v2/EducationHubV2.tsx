import { useState } from "react";
import { Link } from "react-router";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import type { OfferingCardData } from "../OfferingCard";
import { OfferingCard } from "../OfferingCard";
import { CEChip } from "./CEChip";
import { CourseShelfCard } from "./CourseShelfCard";
import { EduBand } from "./EduBand";
import { CatalogOfferingCard } from "./CatalogOfferingCard";

type SessionDot = { id: string; datetime: Date; present: boolean };

type CourseEntry = {
  offeringId: string;
  title: string;
  type: string;
  attended: number;
  total: number;
  nextSessionAt: Date | null;
  isPast: boolean;
  sessionDots: SessionDot[];
  openDueCount: number;
  soonestDueAt: Date | null;
  certificateId: string | null;
};

type OpenCheckIn = {
  sessionId: string;
  offeringTitle: string;
  sessionLabel: string;
  datetime: Date;
  endsAt: Date | null;
};

type Dashboard = {
  myCourses: CourseEntry[];
  openCheckIns: OpenCheckIn[];
};

type CatalogOffering = OfferingCardData & { myStatus?: string | null };

/**
 * Shared v2 Education hub body — used by both the member shell (/education)
 * and the portal (/portal/education). `basePath` drives all internal links so
 * the same JSX works in both surfaces.
 */
export function EducationHubV2({
  basePath,
  ceStanding,
  dashboard,
  upcoming,
  past,
  canManage,
  isCore,
  // Whether we're in the member shell (affects bleed classes on the band).
  isMemberShell,
}: {
  basePath: string;
  ceStanding: { termCode: string; credits: number; compliant: boolean } | null;
  dashboard: Dashboard;
  upcoming: CatalogOffering[];
  past: CatalogOffering[];
  canManage: boolean;
  isCore?: boolean;
  isMemberShell: boolean;
}) {
  const tz = useUserTimeZone();
  const [showPast, setShowPast] = useState(false);

  const { myCourses, openCheckIns } = dashboard;

  // Build a lookup: offeringId → open check-in (at most one per offering
  // because a course can only have one session open for check-in at a time).
  const checkInByOffering = new Map<string, OpenCheckIn>();
  for (const ci of openCheckIns) {
    // Derive offering from offeringTitle match is unreliable; the dashboard
    // attaches offeringTitle — look it up via myCourses.
    const course = myCourses.find((c) => c.title === ci.offeringTitle);
    if (course) checkInByOffering.set(course.offeringId, ci);
  }

  const hasEnrolled = myCourses.length > 0;
  const catalogCount = upcoming.length;

  // Member shell uses negative-margin bleed; portal uses no bleed (no gutters).
  const bleed = isMemberShell ? "-mx-5 sm:-mx-10 lg:-mx-16" : "";
  const bandContent = isMemberShell
    ? "px-5 sm:px-10 lg:px-16"
    : "mx-auto max-w-5xl px-4 sm:px-6";

  return (
    <div className="flex flex-col gap-8">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl font-bold text-foreground">
              {isMemberShell ? "Education" : "Education at DALI"}
            </h1>
            <CEChip ceStanding={ceStanding} />
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-prose">
            {isMemberShell
              ? "Miniseries and workshops run by the lab. Apply or RSVP to a published offering; once you're in, the course hub has sessions, materials, and assignments."
              : "Miniseries and workshops open to Dartmouth students — no lab membership required. Apply or RSVP below; once you're accepted, your course hub opens up here."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canManage && (
            <Link
              to="/education/manage"
              className="inline-flex items-center rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
            >
              Teaching
            </Link>
          )}
          {isCore && isMemberShell && (
            <Link
              to="/education/compliance"
              className="inline-flex items-center rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
            >
              CE Compliance
            </Link>
          )}
        </div>
      </header>

      {/* ── Your courses shelf ─────────────────────────────── */}
      {hasEnrolled && (
        <section>
          <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Your courses
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myCourses.map((course, i) => (
              <CourseShelfCard
                key={course.offeringId}
                course={course}
                checkIn={checkInByOffering.get(course.offeringId)}
                basePath={basePath}
                index={i}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Catalog band ──────────────────────────────────── */}
      <EduBand bleedClassName={bleed} contentClassName={bandContent}>
        {/* Band header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-heading text-lg font-bold text-dark-blue">Catalog</h2>
          {catalogCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {catalogCount} open{catalogCount === 1 ? "" : ""}
            </span>
          )}
        </div>

        {upcoming.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <p className="font-heading font-semibold text-foreground">Nothing open right now</p>
            <p className="text-sm text-muted-foreground mt-1">
              New miniseries and workshops will appear here each term.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((o) => (
              <CatalogOfferingCard key={o.id} offering={o} basePath={basePath} />
            ))}

            {/* "Browse all terms" trailing dashed card */}
            {past.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                className="rounded-2xl border-2 border-dashed border-border p-4 text-left text-muted-foreground hover:border-dark-blue/30 hover:text-foreground transition-colors cursor-pointer"
              >
                <span className="font-heading text-sm font-semibold block mb-1">
                  {showPast ? "Hide past terms" : "Browse all terms"}
                </span>
                <span className="text-xs">
                  {past.length} past offering{past.length === 1 ? "" : "s"}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Expanded past offerings */}
        {showPast && past.length > 0 && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 opacity-80">
            {past.map((o) => (
              <CatalogOfferingCard key={o.id} offering={o} basePath={basePath} />
            ))}
          </div>
        )}
      </EduBand>
    </div>
  );
}
