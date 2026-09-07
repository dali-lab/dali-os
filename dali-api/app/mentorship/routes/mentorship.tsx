import { Link, redirect, useLoaderData } from "react-router";
import { AlertCircle, CalendarClock, ChevronRight } from "lucide-react";
import type { Route } from "./+types/mentorship";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { isCore, currentTermPhase } from "~/lib/roles";
import { interimLabel } from "~/lib/terms.shared";
import { canViewMentorship } from "../lib/visibility";
import { weekNumberInTerm, weekStartForNumber } from "../lib/week";
import {
  buildGrid,
  termWeekCount,
  type MentorGridResult,
} from "../lib/mentor-grid.server";
import { AreaPillNav } from "~/components/AreaPillNav";
import { mentorshipPills } from "../components/mentorshipPills";
import { MentorGrid } from "../components/MentorGrid";
import { EmptyState } from "../components/EmptyState";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "Mentorship · DALI OS" }];

// Surfaces the area subtab row (see layout.tsx's areaPills handling).
export const handle = {
  areaPills: true,
  docKey: "mentorship.hub",
  docTitle: "Mentorship",
};

type LoaderData = {
  isCore: boolean;
  // Where the term calendar sits now — drives whether note nudges apply.
  phase: "in-term" | "break" | "no-terms";
  // The term the grid below is drawn for: the active term, or a preview of the
  // upcoming (or just-ended) term during a break. Null only when no terms exist.
  termId: string | null;
  termCode: string | null;
  // The viewer's own mentees for that term, as a weekly grid.
  grid: MentorGridResult;
  // Core-only oversight: mentors missing a note for the current week. Only
  // meaningful (and only computed) while in-term — 0 during a break.
  behindCount: number;
  // Break context (phase === "break"). Named after the upcoming term's season;
  // null when there's no upcoming term to name the interim after.
  breakLabel: string | null;
  nextTermCode: string | null;
  nextTermStartIso: string | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewMentorship(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const phase = await currentTermPhase(request);
  const userIsCore = await isCore(auth.user.sub);

  // Between terms we still preview the upcoming term's grid (or the just-ended
  // one if nothing's seeded ahead) so mentors can see who they'll have — but
  // nothing reads as "missing" because the term hasn't started (currentWeek 0).
  const gridTerm =
    phase.state === "in-term"
      ? phase.term
      : phase.state === "break"
        ? (phase.next ?? phase.previous)
        : null;

  // The hub grid is "my mentees" — always scoped to the viewer as mentor,
  // regardless of Core status (Core browse-wide from the Notes page instead).
  const grid: MentorGridResult = gridTerm
    ? await buildGrid({
        term: gridTerm,
        pairScope: { mentorUserId: auth.user.sub },
        noteScope: { mentorId: auth.user.sub },
        viewerId: auth.user.sub,
      })
    : { weeks: [], currentWeek: null, mentors: [], termSelected: false };

  // Core extras: how many mentors owe a note for the current week. Suppressed
  // between terms — no note is due when no term is running.
  const behindCount =
    userIsCore && phase.state === "in-term"
      ? await behindOnNotesCount(phase.term)
      : 0;

  const nextTerm = phase.state === "break" ? phase.next : null;

  const data: LoaderData = {
    isCore: userIsCore,
    phase: phase.state,
    termId: gridTerm?.id ?? null,
    termCode: gridTerm?.code ?? null,
    grid,
    behindCount,
    breakLabel: nextTerm ? interimLabel(nextTerm.season) : null,
    nextTermCode: nextTerm?.code ?? null,
    nextTermStartIso: nextTerm?.startDate.toISOString() ?? null,
  };
  return data;
}

// Counts mentees this term who don't have a note for the current week. One
// MentorshipPair = one expected weekly note. Distinct mentees are not
// special-cased — if two mentors share a mentee, each owes their own note.
//
// The "current week" is the term-week containing today, clamped to the term's
// numbered weeks (1..N): before the term's first week nothing is due (returns
// 0), and a tail beyond the last numbered week reports against that last week —
// matching the grid's own week axis (see buildGrid / termWeekCount).
async function behindOnNotesCount(term: {
  id: string;
  startDate: Date;
  endDate: Date;
}): Promise<number> {
  const weekCount = termWeekCount(term.startDate, term.endDate);
  const raw = weekNumberInTerm(new Date(), term.startDate);
  if (raw < 1) return 0;
  const week = Math.min(raw, weekCount);
  const weekOf = weekStartForNumber(term.startDate, week);

  const pairs = await prisma.mentorshipPair.findMany({
    where: { termId: term.id },
    select: {
      mentorUserId: true,
      menteeUserId: true,
      projectId: true,
      domainId: true,
    },
  });
  if (pairs.length === 0) return 0;
  const notes = await prisma.mentorNote.findMany({
    where: { termId: term.id, weekOf },
    select: {
      mentorId: true,
      menteeId: true,
      projectId: true,
      domainId: true,
    },
  });
  const haveKey = new Set(
    notes.map(
      (n) => `${n.mentorId}|${n.menteeId}|${n.projectId}|${n.domainId}`,
    ),
  );
  let behind = 0;
  for (const p of pairs) {
    const key = `${p.mentorUserId}|${p.menteeUserId}|${p.projectId}|${p.domainId}`;
    if (!haveKey.has(key)) behind++;
  }
  return behind;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MentorshipHub() {
  const data = useLoaderData() as LoaderData;
  const { pageTitle, panel, panelPad } = useOsChrome();
  const group = data.grid.mentors[0] ?? null;

  const subtitle =
    data.phase === "in-term"
      ? `Your mentees this term · ${data.termCode}`
      : data.phase === "break"
        ? data.nextTermCode
          ? `Upcoming term · ${data.nextTermCode}`
          : "Between terms"
        : "No active term";

  return (
    <main className="flex flex-col gap-6">
      <AreaPillNav items={mentorshipPills({ active: "hub" })} />
      <header className="flex flex-col gap-1">
        <h1 className={pageTitle}>Mentorship</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>

      {/* On break: no note is due, so replace the oversight nudge with a calm
          banner naming the interim and when notes resume. Shown to everyone. */}
      {data.phase === "break" && (
        <section
          className={cn(panel, panelPad, "flex items-center gap-2 text-sm")}
        >
          <CalendarClock className="w-4 h-4 text-muted-foreground shrink-0" />
          <span>
            {data.breakLabel ? (
              <>
                It's currently <strong>{data.breakLabel}</strong>.{" "}
              </>
            ) : (
              <>You're between terms. </>
            )}
            {data.nextTermCode && data.nextTermStartIso ? (
              <>
                Mentor notes resume when {data.nextTermCode} begins{" "}
                {formatDate(data.nextTermStartIso)}.
              </>
            ) : (
              <>Mentor notes are paused.</>
            )}
          </span>
        </section>
      )}

      {/* Lab-wide oversight — Core/Admin only, and only while a term is live. */}
      {data.isCore && data.phase === "in-term" && data.behindCount > 0 && (
        <section
          className={cn(panel, panelPad, "flex items-center justify-between gap-3")}
        >
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="w-4 h-4 text-accent-coral" />
            <span>
              <strong>{data.behindCount}</strong> mentor
              {data.behindCount === 1 ? " is" : "s are"} missing a note this
              week.
            </span>
          </div>
          {data.termId && (
            <Link
              to={`/mentorship/browse?termId=${data.termId}`}
              className="text-sm text-accent-coral hover:underline inline-flex items-center gap-1"
            >
              View <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </section>
      )}

      {!data.grid.termSelected ? (
        <EmptyState>There's no active term right now.</EmptyState>
      ) : !group || group.rows.length === 0 ? (
        <EmptyState>
          You aren't currently paired with any mentees this term.
        </EmptyState>
      ) : (
        <MentorGrid
          group={group}
          weeks={data.grid.weeks}
          currentWeek={data.grid.currentWeek}
          termId={data.termId ?? ""}
          highlightMissing={data.isCore && data.phase === "in-term"}
          heading="My mentees"
        />
      )}
    </main>
  );
}
