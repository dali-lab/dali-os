import { Link, redirect, useLoaderData } from "react-router";
import { AlertCircle, ChevronRight } from "lucide-react";
import type { Route } from "./+types/mentorship";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { isCore, currentTerm } from "~/lib/roles";
import { canViewMentorship } from "../lib/visibility";
import { currentWeekStart } from "../lib/week";
import { buildGrid, type MentorGridResult } from "../lib/mentor-grid.server";
import { MentorGrid } from "../components/MentorGrid";

export const meta: Route.MetaFunction = () => [{ title: "Mentorship · DALI OS" }];

export const handle = {
  docKey: "mentorship.hub",
  docTitle: "Mentorship",
};

type LoaderData = {
  isCore: boolean;
  termId: string | null;
  termCode: string | null;
  // The viewer's own mentees for the current term, as a weekly grid.
  grid: MentorGridResult;
  // Core-only oversight: mentors missing a note for the current week.
  behindCount: number;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewMentorship(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const term = await currentTerm();
  const userIsCore = await isCore(auth.user.sub);

  // The hub grid is "my mentees" — always scoped to the viewer as mentor,
  // regardless of Core status (Core browse-wide from the Notes page instead).
  const grid: MentorGridResult = term
    ? await buildGrid({
        term,
        pairScope: { mentorUserId: auth.user.sub },
        noteScope: { mentorId: auth.user.sub },
        viewerId: auth.user.sub,
      })
    : { weeks: [], currentWeek: null, mentors: [], termSelected: false };

  // Core extras: how many mentors owe a note for the current week.
  const behindCount =
    userIsCore && term
      ? await behindOnNotesCount(term.id, currentWeekStart())
      : 0;

  const data: LoaderData = {
    isCore: userIsCore,
    termId: term?.id ?? null,
    termCode: term?.code ?? null,
    grid,
    behindCount,
  };
  return data;
}

// Counts mentees this term who don't have a note for the current week.
// One MentorshipPair = one expected weekly note. Distinct mentees are not
// special-cased — if two mentors share a mentee, each owes their own note.
async function behindOnNotesCount(termId: string, weekOf: Date): Promise<number> {
  const pairs = await prisma.mentorshipPair.findMany({
    where: { termId },
    select: {
      mentorUserId: true,
      menteeUserId: true,
      projectId: true,
      domainId: true,
    },
  });
  if (pairs.length === 0) return 0;
  const notes = await prisma.mentorNote.findMany({
    where: { termId, weekOf },
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

export default function MentorshipHub() {
  const data = useLoaderData() as LoaderData;
  const group = data.grid.mentors[0] ?? null;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Mentorship
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.termCode
            ? `Your mentees this term · ${data.termCode}`
            : "No active term"}
        </p>
      </header>

      {/* Lab-wide oversight — Core/Admin only. */}
      {data.isCore && data.behindCount > 0 && (
        <section className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3">
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
          highlightMissing={data.isCore}
          heading="My mentees"
        />
      )}
    </main>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <p className="text-sm text-muted-foreground">{children}</p>
    </section>
  );
}
