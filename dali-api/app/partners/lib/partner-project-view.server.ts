import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { getDownloadUrl } from "~/lib/s3";
import { fullName, primaryEmail } from "~/lib/display";
import { expandOccurrences } from "~/lib/meeting-occurrences";
import { activeProjectPartnerWhere } from "./partner-access";

// The three time states every work item collapses to, so the UI can speak one
// visual language: past (teal/settled), current (coral/live), planned (dashed).
export type PartnerWorkState = "past" | "current" | "planned";

// Kinds of "what's new" activity, each synthesized from existing project data.
export type PartnerActivityKind =
  | "task-done"
  | "sprint-done"
  | "file-shared"
  | "meeting-scheduled";

export type PartnerProjectSprint = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "Active" | "Closed" | "Planned";
  done: number;
  open: number;
};

export type PartnerProjectStory = {
  id: string;
  title: string;
  status: "Todo" | "InProgress" | "Done";
  successMetric: string | null;
  acceptanceCriteria: string | null;
  category: string | null;
  priority: "Must" | "Should" | "Could" | "Wont" | null;
};

export type PartnerProjectEpic = {
  id: string;
  title: string;
  status: "Backlog" | "Open" | "InProgress" | "Done" | "Cancelled";
  startsAt: string | null;
  endsAt: string | null;
  // Scope (what we're building) and schedule (when) — the two parallel
  // children of an epic. Sprints carry every status so the epic reads as a
  // mini past→current→planned timeline.
  stories: PartnerProjectStory[];
  sprints: PartnerProjectSprint[];
};

export type PartnerProjectViewData = {
  project: {
    id: string;
    name: string;
    iconEmoji: string | null;
    description: string | null;
    imageUrl: string | null;
    terms: string[];
  };
  partnerSince: string | null;
  currentTermCode: string | null;
  team: { name: string; domains: string[]; photoUrl: string | null }[];
  // Aggregate live progress across the in-flight sprint(s) — the hero readout.
  // Null when nothing is active (between sprints / not yet started).
  momentum: {
    label: string;
    done: number;
    total: number;
    endsAt: string;
    daysLeft: number;
  } | null;
  // Headline progress for the project status line: overall task completion
  // across every sprint, plus how far through the sprint sequence we are.
  // Purely factual — no subjective "on track" verdict.
  progress: {
    overallDone: number;
    overallTotal: number;
    sprintsStarted: number; // Active + Closed — i.e. sprints under way or done
    sprintCount: number;
  };
  // Roadmap: every non-cancelled epic (position order), each carrying its
  // stories and its full sprint history. Sprints with no epic sit in
  // ungroupedSprints.
  epics: PartnerProjectEpic[];
  ungroupedSprints: PartnerProjectSprint[];
  nextSprint: { name: string; startsAt: string; endsAt: string } | null;
  recentlyDone: {
    id: string;
    title: string;
    doneAt: string;
    domain: string | null;
  }[];
  sharedPages: {
    id: string;
    title: string;
    iconEmoji: string | null;
    updatedAt: string;
  }[];
  // Partner-visible file uploads, each with a short-lived signed download URL
  // resolved server-side — the partner never sees a file id or an API surface.
  sharedFiles: {
    id: string;
    title: string;
    fileName: string | null;
    sizeBytes: number | null;
    contentType: string | null;
    // Attachment URL for the Download button.
    downloadUrl: string | null;
    // Inline-render URL: forces the known content type + inline disposition so
    // the browser previews it even when the S3 object's stored Content-Type is
    // wrong/missing (e.g. generated PDFs served as octet-stream). Mirrors the
    // internal file view (documents.file.$fileId.tsx).
    previewUrl: string | null;
  }[];
  // Upcoming partner-visible meetings on this project, expanded into individual
  // occurrences over a forward window. `id` is the meeting id (shared across a
  // recurring series' occurrences — RSVP and .ics are meeting-level).
  meetings: {
    id: string;
    title: string;
    start: string; // ISO occurrence start
    durationMinutes: number;
    recurring: boolean;
    // Note-page id, present only when the meeting note is itself partner-shared.
    notePageId: string | null;
    attendees: { name: string; email: string }[];
    rsvp: "Accepted" | "Declined" | "Tentative" | null;
  }[];
  // Sprint boundaries as calendar markers, so the timeline isn't only meetings.
  milestones: {
    id: string;
    label: string;
    date: string; // ISO
    kind: "sprint-start" | "sprint-end";
  }[];
  // "What's new" feed, newest first — synthesized from existing data (completed
  // tasks, closed sprints, shared files, scheduled meetings) within a ~30-day
  // window. `isNew` marks events after the viewer's previous visit.
  activity: {
    id: string;
    kind: PartnerActivityKind;
    label: string;
    at: string; // ISO
    isNew: boolean;
  }[];
  // The viewer's previous visit to this project's hub (ISO), or null on a first
  // visit / in the member preview. Drives the "since your last visit" cut.
  lastVisitAt: string | null;
};

// The whole partner read-surface for a project: current epics/sprints, roster,
// recently-closed tasks, and partner-shared docs. Shared by the real partner
// portal (partner.projects.$id.tsx, scoped to the signed-in partner's org)
// and the in-app preview any signed-in member can open from the project page
// (projects.$id.partner-view.tsx, which has no partnerOrgId of its own —
// pass null and partnerSince comes back null).
export async function loadPartnerProjectView(
  projectId: string,
  partnerOrgId: string | null,
  // The signed-in user, used to surface their own RSVP on each meeting. Null
  // in the in-app member preview (no partner RSVP there).
  viewerUserId: string | null = null,
): Promise<PartnerProjectViewData | null> {
  // Every select below is deliberately minimal — this is the whole partner
  // read-surface for a project. No assignees on tasks, no levels on the
  // roster, nothing from unshared pages.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      iconEmoji: true,
      description: true,
      status: true,
      imageUrl: true,
      projectTerms: {
        select: { term: { select: { code: true, sortKey: true } } },
      },
    },
  });
  if (!project) return null;

  const current = await currentTerm();

  const sprintSelect = {
    id: true,
    name: true,
    startsAt: true,
    endsAt: true,
    status: true,
  } as const;

  const [
    partnership,
    assignments,
    epicsRaw,
    ungroupedSprintRows,
    recentlyDone,
    sharedPages,
    sharedFileRows,
  ] = await Promise.all([
      partnerOrgId
        ? prisma.projectPartner.findFirst({
            where: { projectId: project.id, partnerOrgId },
            select: { startedAt: true },
          })
        : Promise.resolve(null),
      current
        ? prisma.projectAssignment.findMany({
            where: { projectId: project.id, termId: current.id },
            select: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  photoUrl: true,
                },
              },
              domain: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      // Cancelled epics are dropped work — partners never see them. Each epic
      // carries its stories (scope) and every sprint (schedule/history).
      prisma.epic.findMany({
        where: { projectId: project.id, status: { not: "Cancelled" } },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          endsAt: true,
          stories: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              status: true,
              successMetric: true,
              acceptanceCriteria: true,
              category: true,
              priority: true,
            },
          },
          sprints: { orderBy: { startsAt: "asc" }, select: sprintSelect },
        },
      }),
      prisma.sprint.findMany({
        where: { projectId: project.id, epicId: null },
        orderBy: { startsAt: "asc" },
        select: sprintSelect,
      }),
      prisma.task.findMany({
        where: { projectId: project.id, status: "Done" },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          id: true,
          title: true,
          updatedAt: true,
          domain: { select: { displayName: true } },
        },
      }),
      prisma.page.findMany({
        where: {
          workspaceType: "Project",
          workspaceId: project.id,
          archivedAt: null,
          partnerVisible: true,
        },
        orderBy: { position: "asc" },
        select: { id: true, title: true, iconEmoji: true, updatedAt: true },
      }),
      prisma.projectFile.findMany({
        where: {
          projectId: project.id,
          archivedAt: null,
          partnerVisible: true,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          createdAt: true,
          currentVersion: {
            select: { fileName: true, sizeBytes: true, s3Key: true, contentType: true },
          },
        },
      }),
    ]);

  // One count pass over every sprint on the board — cheap, and it lets each
  // sprint (past, current, or planned) show its own done/total.
  const allSprintRows = [
    ...epicsRaw.flatMap((e) => e.sprints),
    ...ungroupedSprintRows,
  ];
  const counts = allSprintRows.length
    ? await prisma.task.groupBy({
        by: ["sprintId", "status"],
        where: {
          projectId: project.id,
          sprintId: { in: allSprintRows.map((s) => s.id) },
        },
        _count: { _all: true },
      })
    : [];

  type SprintRow = (typeof allSprintRows)[number];
  function toSprintCard(s: SprintRow): PartnerProjectSprint {
    const mine = counts.filter((c) => c.sprintId === s.id);
    const total = mine.reduce((sum, c) => sum + c._count._all, 0);
    const done = mine
      .filter((c) => c.status === "Done")
      .reduce((sum, c) => sum + c._count._all, 0);
    const cancelled = mine
      .filter((c) => c.status === "Cancelled")
      .reduce((sum, c) => sum + c._count._all, 0);
    return {
      id: s.id,
      name: s.name,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      status: s.status,
      done,
      open: Math.max(0, total - cancelled - done),
    };
  }

  const epics: PartnerProjectEpic[] = epicsRaw.map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    startsAt: e.startsAt?.toISOString() ?? null,
    endsAt: e.endsAt?.toISOString() ?? null,
    stories: e.stories,
    sprints: e.sprints.map(toSprintCard),
  }));
  const ungroupedSprints = ungroupedSprintRows.map(toSprintCard);

  // Dedupe the roster: one row per person, domains joined.
  const roster = new Map<
    string,
    { name: string; domains: Set<string>; photoUrl: string | null }
  >();
  for (const a of assignments) {
    const entry = roster.get(a.user.id) ?? {
      name: fullName(a.user),
      domains: new Set<string>(),
      photoUrl: a.user.photoUrl,
    };
    entry.domains.add(a.domain.name);
    roster.set(a.user.id, entry);
  }
  const team = await Promise.all(
    [...roster.values()].map(async (r) => ({
      name: r.name,
      domains: [...r.domains].sort(),
      photoUrl: await resolvePhotoUrl(r.photoUrl),
    })),
  );

  const allCards = allSprintRows.map(toSprintCard);

  // Factual headline: task completion across the whole board + how far through
  // the sprint sequence the project is ("Sprint 3 of 6"). No health verdict.
  const progress = {
    overallDone: allCards.reduce((sum, c) => sum + c.done, 0),
    overallTotal: allCards.reduce((sum, c) => sum + c.done + c.open, 0),
    sprintsStarted: allCards.filter((c) => c.status !== "Planned").length,
    sprintCount: allCards.length,
  };

  // Aggregate the in-flight sprints into a single hero readout. One active
  // sprint → its name; several → a count. Deadline is the soonest end.
  const activeCards = allCards.filter((c) => c.status === "Active");
  const momentum =
    activeCards.length > 0
      ? (() => {
          const done = activeCards.reduce((sum, c) => sum + c.done, 0);
          const total = activeCards.reduce((sum, c) => sum + c.done + c.open, 0);
          const endsAt = activeCards.map((c) => c.endsAt).sort()[0];
          const daysLeft = Math.max(
            0,
            Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000),
          );
          return {
            label:
              activeCards.length === 1
                ? activeCards[0].name
                : `${activeCards.length} sprints active`,
            done,
            total,
            endsAt,
            daysLeft,
          };
        })()
      : null;

  // Soonest planned sprint anywhere on the board — the "what's next" pointer.
  const nextSprint =
    allCards
      .filter((c) => c.status === "Planned")
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;

  // ─── Calendar: partner-visible meetings + sprint milestones ─────────────────
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 60 * 86_400_000);

  const meetingRows = await prisma.scheduledMeeting.findMany({
    where: {
      projectId: project.id,
      partnerVisible: true,
      status: { not: "Cancelled" },
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      selectedAt: true,
      durationMinutes: true,
      recurrenceRule: true,
      participantUserIds: true,
      notePage: { select: { id: true, partnerVisible: true } },
      exceptions: {
        select: {
          originalStart: true,
          overrideStart: true,
          overrideDurationMin: true,
          cancelled: true,
        },
      },
    },
  });

  const memberIds = [...new Set(meetingRows.flatMap((m) => m.participantUserIds))];
  const [memberUsers, partnerLinks, viewerResponses] = await Promise.all([
    memberIds.length
      ? prisma.user.findMany({
          where: { id: { in: memberIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            daliEmail: true,
            dartmouthEmail: true,
            personalEmail: true,
          },
        })
      : Promise.resolve([]),
    meetingRows.length
      ? prisma.projectPartner.findMany({
          where: { projectId: project.id, ...activeProjectPartnerWhere(now) },
          select: {
            partnerOrg: {
              select: {
                users: {
                  select: {
                    user: {
                      select: {
                        firstName: true,
                        lastName: true,
                        personalEmail: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    viewerUserId && meetingRows.length
      ? prisma.partnerMeetingResponse.findMany({
          where: {
            userId: viewerUserId,
            scheduledMeetingId: { in: meetingRows.map((m) => m.id) },
          },
          select: { scheduledMeetingId: true, rsvp: true },
        })
      : Promise.resolve([]),
  ]);

  const memberById = new Map(memberUsers.map((u) => [u.id, u]));
  const partnerAttendees = partnerLinks.flatMap((l) =>
    l.partnerOrg.users
      .map((u) => ({
        name: fullName(u.user) || u.user.personalEmail || "",
        email: u.user.personalEmail ?? "",
      }))
      .filter((a) => a.email),
  );
  const rsvpByMeeting = new Map(
    viewerResponses.map((r) => [r.scheduledMeetingId, r.rsvp]),
  );

  const meetings = meetingRows
    .flatMap((m) => {
      const memberAttendees = m.participantUserIds
        .map((id) => memberById.get(id))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => ({ name: fullName(u) || primaryEmail(u) || "", email: primaryEmail(u) ?? "" }));
      const attendees = [...memberAttendees, ...partnerAttendees];
      return expandOccurrences(m, m.exceptions, now, windowEnd).map((occ) => ({
        id: m.id,
        title: m.title,
        start: occ.start.toISOString(),
        durationMinutes: Math.round((occ.end.getTime() - occ.start.getTime()) / 60_000),
        recurring: Boolean(m.recurrenceRule),
        notePageId: m.notePage?.partnerVisible ? m.notePage.id : null,
        attendees,
        rsvp: rsvpByMeeting.get(m.id) ?? null,
      }));
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 30);

  const milestones = allCards
    .filter((c) => c.status !== "Closed")
    .flatMap((c) => [
      { id: `${c.id}-start`, label: `${c.name} starts`, date: c.startsAt, kind: "sprint-start" as const },
      { id: `${c.id}-end`, label: `${c.name} ends`, date: c.endsAt, kind: "sprint-end" as const },
    ])
    .filter((mi) => {
      const t = new Date(mi.date).getTime();
      return t >= now.getTime() - 7 * 86_400_000 && t <= windowEnd.getTime();
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // ─── "What's new" activity feed ─────────────────────────────────────────────
  // High-signal events from data we already load, each with a real timestamp.
  // Shared documents are intentionally omitted: a page has no honest "shared
  // at" time (its updatedAt churns on every collab keystroke), so it can't be
  // dated here — a follow-up could add a partnerSharedAt column.
  const activityWindowStart = now.getTime() - 30 * 86_400_000;
  const lastVisit = viewerUserId
    ? await prisma.partnerProjectVisit.findUnique({
        where: {
          userId_projectId: { userId: viewerUserId, projectId: project.id },
        },
        select: { lastSeenAt: true },
      })
    : null;
  const lastVisitMs = lastVisit?.lastSeenAt.getTime() ?? null;

  const rawActivity: {
    id: string;
    kind: PartnerActivityKind;
    label: string;
    atMs: number;
  }[] = [
    ...recentlyDone.map((t) => ({
      id: `task-${t.id}`,
      kind: "task-done" as const,
      label: `Completed “${t.title}”`,
      atMs: t.updatedAt.getTime(),
    })),
    ...allCards
      .filter((c) => c.status === "Closed")
      .map((c) => ({
        id: `sprint-${c.id}`,
        kind: "sprint-done" as const,
        label: `Wrapped ${c.name}`,
        atMs: new Date(c.endsAt).getTime(),
      })),
    ...sharedFileRows.map((f) => ({
      id: `file-${f.id}`,
      kind: "file-shared" as const,
      label: `Shared file “${f.title}”`,
      atMs: f.createdAt.getTime(),
    })),
    ...meetingRows.map((m) => ({
      id: `meeting-${m.id}`,
      kind: "meeting-scheduled" as const,
      label: `Scheduled “${m.title}”`,
      atMs: m.createdAt.getTime(),
    })),
  ];

  const activity = rawActivity
    .filter((a) => a.atMs >= activityWindowStart)
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, 15)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      label: a.label,
      at: new Date(a.atMs).toISOString(),
      isNew: lastVisitMs != null && a.atMs > lastVisitMs,
    }));

  return {
    project: {
      id: project.id,
      name: project.name,
      iconEmoji: project.iconEmoji,
      description: project.description,
      imageUrl: await resolvePhotoUrl(project.imageUrl),
      terms: [...project.projectTerms]
        .sort((a, b) => a.term.sortKey - b.term.sortKey)
        .map((t) => t.term.code),
    },
    partnerSince: partnership?.startedAt?.toISOString() ?? null,
    currentTermCode: current?.code ?? null,
    team,
    momentum,
    progress,
    epics,
    ungroupedSprints,
    nextSprint: nextSprint
      ? {
          name: nextSprint.name,
          startsAt: nextSprint.startsAt,
          endsAt: nextSprint.endsAt,
        }
      : null,
    recentlyDone: recentlyDone.map((t) => ({
      id: t.id,
      title: t.title,
      doneAt: t.updatedAt.toISOString(),
      domain: t.domain?.displayName ?? null,
    })),
    sharedPages: sharedPages.map((p) => ({
      id: p.id,
      title: p.title,
      iconEmoji: p.iconEmoji,
      updatedAt: p.updatedAt.toISOString(),
    })),
    sharedFiles: await Promise.all(
      sharedFileRows.map(async (f) => {
        const s3Key = f.currentVersion?.s3Key ?? null;
        const contentType = f.currentVersion?.contentType ?? null;
        return {
          id: f.id,
          title: f.title,
          fileName: f.currentVersion?.fileName ?? null,
          sizeBytes: f.currentVersion?.sizeBytes ?? null,
          contentType,
          downloadUrl: s3Key ? await getDownloadUrl(s3Key) : null,
          previewUrl: s3Key
            ? await getDownloadUrl(s3Key, {
                contentType: contentType ?? undefined,
                inline: true,
              })
            : null,
        };
      }),
    ),
    meetings,
    milestones,
    activity,
    lastVisitAt: lastVisit?.lastSeenAt.toISOString() ?? null,
  };
}
