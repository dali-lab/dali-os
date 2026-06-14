import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { Users, FileText, AlertCircle, ChevronRight } from "lucide-react";
import type { Route } from "./+types/mentorship";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore, currentTerm } from "~/lib/roles";
import { canViewMentorship } from "../lib/visibility";
import { currentWeekStart } from "../lib/week";

export const meta: Route.MetaFunction = () => [{ title: "Mentorship · DALI OS" }];

type Mentee = {
  pairId: string;
  user: { id: string; firstName: string; lastName: string };
  project: { id: string; name: string };
  domain: { id: string; code: string; displayName: string };
  termId: string;
  thisWeekNoteId: string | null;
};

type NoteRow = {
  id: string;
  weekOf: string;
  mentor: { id: string; firstName: string; lastName: string };
  mentee: { id: string; firstName: string; lastName: string };
  projectName: string;
  domainCode: string;
};

type LoaderData = {
  isCore: boolean;
  weekOfIso: string;
  termCode: string | null;
  myMentees: Mentee[];
  myRecentNotes: NoteRow[];
  // Core-only:
  labRecentNotes: NoteRow[];
  behindCount: number;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewMentorship(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const term = await currentTerm();
  const weekOf = currentWeekStart();
  const userIsCore = await isCore(auth.user.sub);

  // Mentees I'm assigned to this term, with this-week note status.
  const pairs = term
    ? await prisma.mentorshipPair.findMany({
        where: { mentorUserId: auth.user.sub, termId: term.id },
        select: {
          id: true,
          projectId: true,
          termId: true,
          domainId: true,
          mentee: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    : [];

  const projectIds = [...new Set(pairs.map((p) => p.projectId))];
  const domainIds = [...new Set(pairs.map((p) => p.domainId))];
  const [projectRows, domainRows, thisWeekNotes] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    }),
    prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true, code: true, displayName: true },
    }),
    term
      ? prisma.mentorNote.findMany({
          where: {
            mentorId: auth.user.sub,
            termId: term.id,
            weekOf,
            menteeId: { in: pairs.map((p) => p.mentee.id) },
          },
          select: { id: true, menteeId: true, projectId: true, domainId: true },
        })
      : [],
  ]);
  const projectMap = new Map(projectRows.map((p) => [p.id, p]));
  const domainMap = new Map(domainRows.map((d) => [d.id, d]));
  const noteByPair = new Map(
    thisWeekNotes.map((n) => [`${n.menteeId}|${n.projectId}|${n.domainId}`, n.id]),
  );

  const myMentees: Mentee[] = pairs.map((p) => {
    const key = `${p.mentee.id}|${p.projectId}|${p.domainId}`;
    return {
      pairId: p.id,
      user: p.mentee,
      project: projectMap.get(p.projectId) ?? { id: p.projectId, name: "Unknown" },
      domain: domainMap.get(p.domainId) ?? {
        id: p.domainId,
        code: "?",
        displayName: "Unknown",
      },
      termId: p.termId,
      thisWeekNoteId: noteByPair.get(key) ?? null,
    };
  });

  // The viewer's most recent notes across all terms.
  const myRecentRaw = await prisma.mentorNote.findMany({
    where: { mentorId: auth.user.sub },
    orderBy: [{ weekOf: "desc" }, { updatedAt: "desc" }],
    take: 12,
    select: {
      id: true,
      weekOf: true,
      projectId: true,
      domainId: true,
      mentor: { select: { id: true, firstName: true, lastName: true } },
      mentee: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Core extras: lab-wide recent + behind-on-notes count.
  let labRecentRaw: typeof myRecentRaw = [];
  let behindCount = 0;
  if (userIsCore && term) {
    [labRecentRaw, behindCount] = await Promise.all([
      prisma.mentorNote.findMany({
        orderBy: [{ updatedAt: "desc" }],
        take: 12,
        select: {
          id: true,
          weekOf: true,
          projectId: true,
          domainId: true,
          mentor: { select: { id: true, firstName: true, lastName: true } },
          mentee: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      behindOnNotesCount(term.id, weekOf),
    ]);
  }

  const allProjectIds = [
    ...new Set([
      ...myRecentRaw.map((n) => n.projectId),
      ...labRecentRaw.map((n) => n.projectId),
    ]),
  ];
  const allDomainIds = [
    ...new Set([
      ...myRecentRaw.map((n) => n.domainId),
      ...labRecentRaw.map((n) => n.domainId),
    ]),
  ];
  const [allProjects, allDomains] = await Promise.all([
    allProjectIds.length
      ? prisma.project.findMany({
          where: { id: { in: allProjectIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    allDomainIds.length
      ? prisma.domain.findMany({
          where: { id: { in: allDomainIds } },
          select: { id: true, code: true },
        })
      : Promise.resolve([] as { id: string; code: string }[]),
  ]);
  const allProjectMap = new Map(allProjects.map((p) => [p.id, p]));
  const allDomainMap = new Map(allDomains.map((d) => [d.id, d]));

  function toRow(n: (typeof myRecentRaw)[number]): NoteRow {
    return {
      id: n.id,
      weekOf: n.weekOf.toISOString(),
      mentor: n.mentor,
      mentee: n.mentee,
      projectName: allProjectMap.get(n.projectId)?.name ?? "Unknown",
      domainCode: allDomainMap.get(n.domainId)?.code ?? "?",
    };
  }

  const data: LoaderData = {
    isCore: userIsCore,
    weekOfIso: weekOf.toISOString(),
    termCode: term?.code ?? null,
    myMentees,
    myRecentNotes: myRecentRaw.map(toRow),
    labRecentNotes: labRecentRaw.map(toRow),
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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fullName(u: { firstName: string; lastName: string }) {
  return `${u.firstName} ${u.lastName}`.trim();
}

export default function MentorshipHub() {
  const data = useLoaderData() as LoaderData;
  const openFetcher = useFetcher();

  function openOrCreateNote(m: Mentee) {
    const fd = new FormData();
    fd.append("menteeId", m.user.id);
    fd.append("projectId", m.project.id);
    fd.append("termId", m.termId);
    fd.append("domainId", m.domain.id);
    fd.append("weekOf", data.weekOfIso);
    openFetcher.submit(fd, {
      method: "post",
      action: "/mentorship?intent=open",
      encType: "application/x-www-form-urlencoded",
    });
  }

  return (
    <main className="px-4 md:px-8 py-6 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Mentorship
        </h1>
        <p className="text-sm text-muted-foreground">
          Week of {fmtDate(data.weekOfIso)}
          {data.termCode ? ` · ${data.termCode}` : ""}
        </p>
      </header>

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
          <Link
            to={`/mentorship/browse?weekOf=${data.weekOfIso.slice(0, 10)}&status=missing`}
            className="text-sm text-accent-coral hover:underline inline-flex items-center gap-1"
          >
            View <ChevronRight className="w-4 h-4" />
          </Link>
        </section>
      )}

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <Users className="w-4 h-4 text-accent-coral" />
          My mentees this week
        </h2>
        {data.myMentees.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You aren't currently paired with any mentees this term.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.myMentees.map((m) => {
              const noteId = m.thisWeekNoteId;
              return (
                <li
                  key={m.pairId}
                  className="py-2 flex items-center justify-between gap-3"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {fullName(m.user)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {m.project.name} · {m.domain.displayName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        noteId
                          ? "text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-300"
                          : "text-xs px-2 py-0.5 rounded-full bg-accent-coral/15 text-accent-coral"
                      }
                    >
                      {noteId ? "Note written" : "Missing"}
                    </span>
                    {noteId ? (
                      <Link
                        to={`/mentorship/notes/${noteId}`}
                        className="text-sm text-accent-coral hover:underline"
                      >
                        Open
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openOrCreateNote(m)}
                        disabled={openFetcher.state !== "idle"}
                        className="text-sm text-accent-coral hover:underline disabled:opacity-50"
                      >
                        Write
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
            <FileText className="w-4 h-4 text-accent-coral" />
            My recent notes
          </h2>
          <Link
            to="/mentorship/browse"
            className="text-sm text-accent-coral hover:underline"
          >
            Browse all
          </Link>
        </div>
        {data.myRecentNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.myRecentNotes.map((n) => (
              <li
                key={n.id}
                className="py-2 flex items-center justify-between gap-3"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">
                    {fullName(n.mentee)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {n.projectName} · {n.domainCode} · week of {fmtDate(n.weekOf)}
                  </span>
                </div>
                <Link
                  to={`/mentorship/notes/${n.id}`}
                  className="text-sm text-accent-coral hover:underline"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.isCore && (
        <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
            <FileText className="w-4 h-4 text-accent-coral" />
            Lab-wide recent notes
          </h2>
          {data.labRecentNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No notes have been written across the lab yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.labRecentNotes.map((n) => (
                <li
                  key={n.id}
                  className="py-2 flex items-center justify-between gap-3"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {fullName(n.mentor)} → {fullName(n.mentee)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {n.projectName} · {n.domainCode} · week of {fmtDate(n.weekOf)}
                    </span>
                  </div>
                  <Link
                    to={`/mentorship/notes/${n.id}`}
                    className="text-sm text-accent-coral hover:underline"
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

// Action: ?intent=open posts to /api/mentorship/notes via fetcher, then redirects.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await canViewMentorship(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }
  const form = await request.formData();
  const body = {
    menteeId: String(form.get("menteeId") ?? ""),
    projectId: String(form.get("projectId") ?? ""),
    termId: String(form.get("termId") ?? ""),
    domainId: String(form.get("domainId") ?? ""),
    weekOf: String(form.get("weekOf") ?? ""),
  };

  // Mirror the API route's open-or-create behavior so we can redirect to the
  // editor directly from the hub button.
  const term = await prisma.term.findUnique({ where: { id: body.termId }, select: { id: true } });
  if (!term) throw new Response("Bad request", { status: 400 });
  const { startOfWeekUTC } = await import("../lib/week");
  const weekOf = startOfWeekUTC(body.weekOf);

  const existing = await prisma.mentorNote.findUnique({
    where: {
      mentorId_menteeId_projectId_termId_domainId_weekOf: {
        mentorId: auth.user.sub,
        menteeId: body.menteeId,
        projectId: body.projectId,
        termId: body.termId,
        domainId: body.domainId,
        weekOf,
      },
    },
    select: { id: true },
  });
  if (existing) return redirect(`/mentorship/notes/${existing.id}`);

  const template = await prisma.mentorNoteTemplate.findFirst({
    where: { isDefault: true },
    select: { contentJson: true },
  });
  const created = await prisma.mentorNote.create({
    data: {
      mentorId: auth.user.sub,
      menteeId: body.menteeId,
      projectId: body.projectId,
      termId: body.termId,
      domainId: body.domainId,
      weekOf,
      contentJson: (template?.contentJson ?? {}) as object,
    },
    select: { id: true },
  });
  return redirect(`/mentorship/notes/${created.id}`);
}
