import { redirect } from "react-router";
import { redactCoreOnlyProjectFields } from "~/lib/project-field-visibility";
import { listProjectChartStrings } from "~/lib/chart-string.server";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { buildProjectCalendar } from "~/projects/lib/project-calendar.server";
import { prisma } from "~/lib/db.server";
import { activeDomainOptions } from "~/lib/reference-cache.server";
import { listKnownOrgs, loadProjectInfra } from "~/lib/infra/dashboard.server";
import { listProjectInfraRequests } from "~/lib/infra/requests.server";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { coreBoardPathFor } from "~/core/lib/taskboard";
import { fullName, UNKNOWN_LABEL } from "~/lib/display";
import { USER_NAME_SELECT } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { getCollabToken } from "~/lib/collab-token.server";
import {
  getUserRoles,
  isCore,
  isProjectMember,
  canManageStaffing,
  currentTerm,
  isLabMentor,
} from "~/lib/roles";
import { listActiveCoreMembers, personName } from "~/partners/lib/core-members.server";
import { getPresenceUser } from "~/lib/presence-user";
import { type TimelineEpic, type TaskDependencyEdge } from "~/projects/components/EpicsTimeline";
import { buildTimelineEpics } from "~/projects/lib/timeline-epics";
import { type EditableEpic } from "~/projects/components/EpicSprintManager";
import {
  assignableAssignments,
  taskTermIds,
  termIdsInRange,
  isTaskFinished,
  type TaskBoardOptions,
  type TaskCardModel,
  type TaskStatus,
  type Priority,
} from "~/projects/lib/task-board";
import {
  computeProjectStatus,
  computeStatusBreakdown,
  factsFingerprint,
  type ProjectWorkStatus,
} from "~/projects/lib/project-status";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { isAiEnabled } from "~/lib/ai.server";
import { loadProjectDriveScope } from "~/lib/drive-scopes.server";
import { PROJECT_PAGE_SELECT, PROJECT_FILE_SELECT } from "~/lib/drive.server";

// Audit actions surfaced in the Overview "Recent activity" card. Restricted to
// actions whose metadata reliably carries a projectId — document.delete,
// projectFile.version, and projectFile.delete don't record one, so they can't
// be attributed to a project here without extra joins.
const PROJECT_ACTIVITY_ACTIONS = [
  "projectFile.create",
  "projectFile.partner-visibility",
  "page.partner-visibility",
  "page.public-visibility",
  "project.showcase-status",
  "project.assignment.level",
  "partner.project.link",
  "partner.project.update",
  "partner.project.unlink",
] as const;

export async function loadProjectDetail({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;

  // ── Stage 1: project row + project-independent queries in parallel ──────────
  // allDomains, bidDomains, allTerms, and role checks don't need the project
  // row, so they run alongside it.
  const [project, roles, allDomains, allTerms] = await Promise.all([
    prisma.project.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      kind: true,
      description: true,
      status: true,
      maintenancePlans: { where: { endedAt: null }, take: 1, select: { plan: true } },
      aiTldr: true,
      aiTldrGeneratedAt: true,
      aiTldrInputHash: true,
      calendarEmail: true,
      teamGroupEmail: true,
      imageUrl: true,
      iconEmoji: true,
      repoUrls: true,
      figmaUrls: true,
      deploymentUrl: true,
      githubTeamSlug: true,
      slackChannelName: true,
      slackChannelId: true,
      isPrivate: true,
      recordingPolicy: true,
      meetingNoteTemplate: { select: { id: true, title: true } },
      overviewPageId: true,
      prdPageId: true,
      projectTerms: {
        select: {
          piUserId: true,
          pi: {
            select: { id: true, firstName: true, lastName: true, daliEmail: true },
          },
          term: {
            select: {
              id: true,
              code: true,
              sortKey: true,
              startDate: true,
              endDate: true,
            },
          },
        },
      },
      termCount: true,
      partners: {
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          partnerOrg: {
            select: {
              id: true,
              name: true,
              logoUrl: true,
              website: true,
              memberships: {
                where: { endedAt: null },
                select: {
                  id: true,
                  role: true,
                  contact: { select: { name: true, email: true } },
                },
              },
            },
          },
        },
      },
      termStatuses: {
        select: {
          id: true,
          isContinuing: true,
          gcalLink: true,
          zoomLink: true,
          sowPageId: true,
          term: { select: { code: true, sortKey: true } },
        },
      },
      assignments: {
        select: {
          id: true,
          level: true,
          userId: true,
          termId: true,
          domainId: true,
          user: { select: { ...USER_NAME_SELECT, photoUrl: true } },
          term: { select: { code: true, sortKey: true } },
          domain: { select: { id: true, name: true } },
        },
      },
      epics: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          startsAt: true,
          endsAt: true,
          descriptionDocId: true,
          // Edges where this epic is the dependent (waits on another).
          dependencies: { select: { dependsOnEpicId: true } },
          stories: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              notes: true,
              status: true,
              startsAt: true,
              endsAt: true,
              successMetric: true,
              acceptanceCriteria: true,
              category: true,
              priority: true,
              // Edges where this story is the dependent (waits on another).
              dependencies: { select: { dependsOnStoryId: true } },
            },
          },
        },
      },
      tasks: {
        // Archived tasks (auto-archived Done/Cancelled) drop off the board.
        // Safety bound: 1000 tasks is well above any real project; keeps the
        // payload bounded without splitting the tab (a future client change).
        where: { archivedAt: null },
        orderBy: { createdAt: "asc" },
        take: 1000,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          position: true,
          dueAt: true,
          startsAt: true,
          epicId: true,
          storyId: true,
          checklist: true,
          githubIssueNumber: true,
          githubIssueUrl: true,
          createdAt: true,
          activityAt: true,
          createdBy: { select: USER_NAME_SELECT },
          domain: { select: { id: true, displayName: true } },
          assignees: {
            select: {
              user: { select: USER_NAME_SELECT },
            },
          },
          files: {
            where: { file: { archivedAt: null } },
            select: {
              file: {
                select: {
                  id: true,
                  title: true,
                  _count: { select: { versions: true } },
                },
              },
            },
          },
          _count: { select: { comments: true } },
          // Edges where this task is the dependent (waits on another).
          dependencies: { select: { dependsOnTaskId: true } },
        },
      },
      // Declared domains for this project — editable from the Overview tab.
      // Distinct from per-assignment domains (which describe who's actually
      // staffed in which domain this term).
      domains: {
        select: { domain: { select: { id: true, displayName: true } } },
      },
    },
  }),
    // Role flags — cached per-request, so later per-flag helpers (isCore etc.)
    // in the action and downstream helpers don't re-query.
    getUserRoles(auth.user.sub, request),
    // Domain editor option list — project-independent.
    activeDomainOptions(),
    // All terms — ascending (chronological) for sprint→term resolvers;
    // display lists re-sort to newest-first where needed. Project-independent.
    prisma.term.findMany({
      orderBy: { sortKey: "asc" },
      select: {
        id: true,
        code: true,
        sortKey: true,
        startDate: true,
        endDate: true,
      },
    }),
  ]);
  // ── End Stage 1 ──────────────────────────────────────────────────────────────

  if (!project) throw new Response("Not found", { status: 404 });
  if (project.kind === "CoreBoard") return redirect(coreBoardPathFor(request.url));

  // After the gate, so a 404 never lands in someone's recents. Detached —
  // a failed bookkeeping write must not cost the reader their project.
  recordRouteVisit(auth.user.sub, `/projects/${project.id}`, project.name, request);

  // ── Role derivation (Stage 1 already called getUserRoles) ───────────────────
  // Content edits (name/status, description, details, docs/files, epics/
  // sprints/tasks) are open to Core/Admin *and* anyone staffed on this project
  // in any term. Scope/domain settings stay Core/Admin only (canEditScope).
  const core = roles.isCore;
  const canEditScope = core;
  // isProjectMember and isLabMentor need request for cachedForRequest dedup;
  // they're called here with request so any repeated call inside helpers is free.
  const [canEdit, canViewScope, canViewMentorshipTab] = await Promise.all([
    core ? Promise.resolve(true) : isProjectMember(auth.user.sub, params.id, request),
    // The Scope/challenge settings popup is visible to Core, Admin, or staffing
    // leads. Editing still requires canEditScope (isCore) — the action enforces that.
    core ? Promise.resolve(true) : canManageStaffing(auth.user.sub, request),
    // Mentorship tab is for the mentor collective (lab mentors + Core). Mentees
    // never see it on the project page.
    core ? Promise.resolve(true) : isLabMentor(auth.user.sub, undefined, request),
  ]);

  // ── Stage 2: everything that depends on the project row ──────────────────────
  const [
    pageRows,
    fileRows,
    taskViews,
    scopeRows,
    bidDomains,
    linkablePartnerOrgs,
    meetingRows,
    presenceUser,
    activityRows,
  ] = await Promise.all([
    // Project pages, reused as `preloadedProjectPages` for the Drive tab below.
    prisma.page.findMany({
      where: {
        workspaceType: "Project",
        workspaceId: project.id,
        archivedAt: null,
      },
      orderBy: { position: "asc" },
      select: PROJECT_PAGE_SELECT,
    }),
    // Project files, reused as `preloadedProjectFiles` for the Drive tab below.
    prisma.projectFile.findMany({
      where: { projectId: project.id, archivedAt: null },
      orderBy: { createdAt: "asc" },
      select: PROJECT_FILE_SELECT,
    }),
    // Viewer's "last opened" stamp per task for board unread dots.
    project.tasks.length
      ? prisma.taskView.findMany({
          where: { userId: auth.user.sub, taskId: { in: project.tasks.map((t) => t.id) } },
          select: { taskId: true, viewedAt: true },
        })
      : Promise.resolve([]),
    // Scope rows for this project (small N — at most |declared| × termCount).
    prisma.projectDomainScope.findMany({
      where: { projectId: project.id },
      select: { domainId: true, termId: true, scope: true },
    }),
    // Bid domains — fallback-from-staffing data when declaredDomains is empty.
    prisma.staffingPreference.findMany({
      where: { projectId: project.id },
      select: { domainId: true },
      distinct: ["domainId"],
    }),
    // Orgs not yet linked, for the Core-only link picker.
    core
      ? prisma.partnerOrg.findMany({
          where: { projects: { none: { projectId: project.id } } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    // Next upcoming meetings for this project (Overview card). Bounded to 5;
    // cancelled and unscheduled (selectedAt null) meetings are excluded.
    prisma.scheduledMeeting.findMany({
      where: {
        projectId: project.id,
        status: { not: "Cancelled" },
        selectedAt: { gte: new Date() },
      },
      orderBy: { selectedAt: "asc" },
      take: 5,
      select: { id: true, title: true, selectedAt: true, durationMinutes: true },
    }),
    // Presence user (collab editor wiring).
    getPresenceUser(
      auth.user.sub,
      [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email,
    ),
    // Recent project-scoped audit activity. AuditLog has no Prisma user
    // relation (bare userId String?), so we fetch actor names in a second
    // query. Both are awaited together inside an async IIFE so they still
    // run concurrently with the rest of Stage 2, and the two sub-queries
    // are sequential only within the activity fetch itself.
    canEdit
      ? (async () => {
          const rows = await prisma.auditLog.findMany({
            where: {
              action: { in: [...PROJECT_ACTIVITY_ACTIONS] },
              metadata: { path: ["projectId"], equals: project.id },
            },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { id: true, action: true, userId: true, createdAt: true },
          });
          const actorIds = [...new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])))];
          const actors = actorIds.length
            ? await prisma.user.findMany({
                where: { id: { in: actorIds } },
                select: USER_NAME_SELECT,
              })
            : [];
          const actorNameById = new Map(actors.map((u) => [u.id, fullName(u)]));
          return rows.map((r) => ({
            id: r.id,
            action: r.action,
            actorName: (r.userId ? actorNameById.get(r.userId) : null) ?? UNKNOWN_LABEL,
            createdAt: r.createdAt.toISOString(),
          }));
        })()
      : Promise.resolve([] as { id: string; action: string; actorName: string; createdAt: string }[]),
  ]);
  // ── End Stage 2 ──────────────────────────────────────────────────────────────

  const collabToken = await getCollabToken(request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
    auth.user.email;
  const userName = presenceUser?.name ?? fallbackName;

  // ─── Timeline model (epic → story → task) ────────────────────────────────
  // Every level is nested containment: a story bar sits inside its epic bar, a
  // task bar inside its story bar. Only epics resolve to a null span (rendered
  // as unscheduled); stories and tasks always inherit a span from their parent,
  // so a bar never disappears out from under its children. The span resolution
  // itself lives in ../lib/timeline-epics — the partner hub draws the same bars.
  const epics: TimelineEpic[] = buildTimelineEpics({
    epics: project.epics,
    tasks: project.tasks.map((t) => ({
      id: t.id,
      epicId: t.epicId,
      storyId: t.storyId,
      startsAt: t.startsAt,
      dueAt: t.dueAt,
      title: t.title,
      status: t.status,
      assignees: t.assignees,
      commentCount: t._count.comments,
      fileCount: t.files.length,
    })),
  });

  const editableEpics: EditableEpic[] = project.epics.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    status: e.status as EditableEpic["status"],
    startsAt: e.startsAt ? e.startsAt.toISOString() : null,
    endsAt: e.endsAt ? e.endsAt.toISOString() : null,
    descriptionDocId: e.descriptionDocId,
    dependsOn: e.dependencies.map((d) => d.dependsOnEpicId),
    stories: e.stories.map((s) => ({
      id: s.id,
      title: s.title,
      notes: s.notes,
      status: s.status as EditableEpic["stories"][number]["status"],
      startsAt: s.startsAt ? s.startsAt.toISOString() : null,
      endsAt: s.endsAt ? s.endsAt.toISOString() : null,
      dependsOn: s.dependencies.map((d) => d.dependsOnStoryId),
      successMetric: s.successMetric,
      acceptanceCriteria: s.acceptanceCriteria,
      category: s.category,
      priority: s.priority,
    })),
  }));

  // Flat directed dependency edges (storyId waits on dependsOnStoryId), drawn
  // as arrows between story bars on the timeline.
  const storyDependencies = project.epics.flatMap((e) =>
    e.stories.flatMap((st) =>
      st.dependencies.map((d) => ({
        storyId: st.id,
        dependsOnStoryId: d.dependsOnStoryId,
      })),
    ),
  );

  // The same shape one level up: epicId waits on dependsOnEpicId.
  const epicDependencies = project.epics.flatMap((e) =>
    e.dependencies.map((d) => ({
      epicId: e.id,
      dependsOnEpicId: d.dependsOnEpicId,
    })),
  );

  // And one level down: taskId waits on dependsOnTaskId. `open` says whether
  // the blocker is unfinished; a blocker missing from the live set was
  // archived, which only happens to Done/Cancelled work.
  const liveTaskById = new Map(project.tasks.map((t) => [t.id, t]));
  const taskDependencies: TaskDependencyEdge[] = project.tasks.flatMap((t) =>
    t.dependencies.map((d) => {
      const blocker = liveTaskById.get(d.dependsOnTaskId);
      return {
        taskId: t.id,
        dependsOnTaskId: d.dependsOnTaskId,
        open: !!blocker && !isTaskFinished(blocker),
      };
    }),
  );

  // Viewer's "last opened" stamp per task — fetched in Stage 2, now indexed.
  const viewedAtByTaskId = new Map(taskViews.map((v) => [v.taskId, v.viewedAt]));

  const tasks: TaskCardModel[] = project.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    priority: t.priority as Priority,
    position: t.position,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    startsAt: t.startsAt ? t.startsAt.toISOString() : null,
    epicId: t.epicId,
    storyId: t.storyId,
    dependsOn: t.dependencies.map((d) => d.dependsOnTaskId),
    checklist: (t.checklist as TaskCardModel["checklist"]) ?? null,
    assignees: t.assignees.map((a) => ({
      id: a.user.id,
      name: fullName(a.user),
    })),
    domain: t.domain
      ? { id: t.domain.id, name: t.domain.displayName }
      : null,
    githubIssueUrl: t.githubIssueUrl,
    githubIssueNumber: t.githubIssueNumber,
    files: t.files.map((l) => ({
      id: l.file.id,
      title: l.file.title,
      versionCount: l.file._count.versions,
    })),
    commentCount: t._count.comments,
    createdBy: { id: t.createdBy.id, name: fullName(t.createdBy) },
    createdAt: t.createdAt.toISOString(),
    activityAt: t.activityAt.toISOString(),
    hasUnread: (() => {
      const viewedAt = viewedAtByTaskId.get(t.id);
      return !!viewedAt && t.activityAt > viewedAt;
    })(),
  }));

  // Team grouped by term, newest term first. Current = highest sortKey.
  // Levels are read-only here — Core edits them from the member's profile
  // (the row links out to /members/:id#project-assignments).
  type TeamMember = {
    assignmentId: string;
    userId: string;
    name: string;
    photoUrl: string | null;
    domain: string;
    domainId: string;
    level: string;
  };
  const teamByTerm = new Map<
    string,
    { code: string; sortKey: number; members: TeamMember[] }
  >();
  const photoByUserId = new Map<string, string | null>();
  const uniqueUsers = new Map(
    project.assignments.map((a) => [a.userId, a.user.photoUrl] as const),
  );
  await Promise.all(
    [...uniqueUsers].map(async ([userId, photoUrl]) => {
      photoByUserId.set(userId, await resolvePhotoUrl(photoUrl));
    }),
  );
  for (const a of project.assignments) {
    const key = a.term.code;
    if (!teamByTerm.has(key)) {
      teamByTerm.set(key, { code: a.term.code, sortKey: a.term.sortKey, members: [] });
    }
    teamByTerm.get(key)!.members.push({
      assignmentId: a.id,
      userId: a.userId,
      name: fullName(a.user),
      photoUrl: photoByUserId.get(a.userId) ?? null,
      domain: a.domain.name,
      domainId: a.domainId,
      level: a.level,
    });
  }
  const teams = [...teamByTerm.values()].sort((a, b) => b.sortKey - a.sortKey);

  const termStatuses = [...project.termStatuses].sort(
    (a, b) => b.term.sortKey - a.term.sortKey,
  );

  // allDomains fetched in Stage 1; bidDomains fetched in Stage 2.
  // Domain editor option list + fallback-from-staffing data. The detail page
  // displays declared domains directly; if none are declared, it falls back
  // to the union of domains seen on this project's bids + assignments so a
  // project that's actively being staffed still shows its domain footprint.
  const declaredDomains = project.domains.map((d) => ({
    id: d.domain.id,
    name: d.domain.displayName,
  }));

  // The project's term set is now explicit (ProjectTerm rows), editable on
  // this page, and need not be consecutive. Sorted descending so the display
  // surfaces the most recent term first; the scope grid uses this same set.
  const plannedTerms = project.projectTerms
    .map((pt) => pt.term)
    .sort((a, b) => b.sortKey - a.sortKey);

  // Per-term Principal Investigator (Core lead on this project for the term).
  // Keyed by termId so the team section can label each term with its PI and
  // (for Core viewers) swap it inline.
  const pisByTerm: Record<string, { userId: string; name: string } | null> =
    Object.fromEntries(
      project.projectTerms.map((pt) => [
        pt.term.id,
        pt.pi
          ? { userId: pt.pi.id, name: personName(pt.pi) }
          : null,
      ]),
    );
  // Core-only member list fuels the PI picker; everyone else sees a read-only
  // label so we skip the query.
  const coreMembers = core ? await listActiveCoreMembers(request) : [];

  // Start term is derived as the earliest term in the set (lowest sortKey),
  // not a stored field. Null when the project has no terms yet.
  const startTerm =
    plannedTerms.length > 0 ? plannedTerms[plannedTerms.length - 1] : null;

  // Active-this-term is derived from membership: the project is active iff the
  // current term is in its set. Distinct from the manual status enum
  // (Paused/Archived), which the lead still controls explicitly.
  // Thread request so cachedForRequest deduplicates this against any prior
  // call inside role helpers (isLabMentor etc.) on this same request.
  const current = await currentTerm(request);
  const isActiveThisTerm =
    current !== null && plannedTerms.some((t) => t.id === current.id);

  // ─── Board term derivation ───────────────────────────────────────────────
  // Term-ness on the board is derived from dates, never stored: a task counts
  // toward every term its span overlaps (roll-forward through break weeks,
  // mirroring currentTerm()), and an epic toward the terms its effective span
  // (widened to cover its stories/tasks by buildTimelineEpics) overlaps. So
  // moving work into a past term is just giving it that term's dates.
  // Term.startDate/endDate stays the single source of truth.
  // `allTerms` is ascending here, which taskTermIds/termIdsInRange rely on.
  const epicSpanById = new Map(
    epics.map((e) => [e.id, { startsAt: e.startsAt, endsAt: e.endsAt }]),
  );
  const boardEpics = project.epics.map((e) => {
    const ids = new Set<string>();
    const span = epicSpanById.get(e.id);
    const start = span?.startsAt ? new Date(span.startsAt) : null;
    const end = span?.endsAt ? new Date(span.endsAt) : null;
    for (const tid of termIdsInRange(allTerms, start, end)) ids.add(tid);
    return { id: e.id, title: e.title, termIds: [...ids] };
  });
  // Term filter options: the project's planned terms (settings) always appear.
  // Work *derived* into an unplanned term earns that term a filter option too —
  // but only looking backward. A task or epic dated into a *future* term must
  // not silently grow the board's term set past what was planned (that inflated
  // the filter with future terms nobody selected); plan ahead by adding the
  // term in settings, which lands it in `plannedTerms` and keeps it here.
  const sortKeyById = new Map(allTerms.map((t) => [t.id, t.sortKey]));
  const currentSortKey =
    current && sortKeyById.has(current.id) ? sortKeyById.get(current.id)! : null;
  const isFutureTerm = (termId: string) =>
    currentSortKey !== null && (sortKeyById.get(termId) ?? -Infinity) > currentSortKey;
  const boardTermIds = new Set<string>();
  for (const t of plannedTerms) boardTermIds.add(t.id);
  for (const e of boardEpics)
    for (const tid of e.termIds) if (!isFutureTerm(tid)) boardTermIds.add(tid);
  for (const t of tasks)
    for (const tid of taskTermIds(allTerms, t)) if (!isFutureTerm(tid)) boardTermIds.add(tid);
  const boardTermList = allTerms.filter((t) => boardTermIds.has(t.id));
  const boardTerms = [...boardTermList]
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((t) => ({ id: t.id, code: t.code }));
  const boardCurrentTermId =
    current && boardTermIds.has(current.id) ? current.id : null;

  // Board option lists for the TaskModal: members assignable on this project,
  // and every active domain (reuses the `allDomains` fetch above).
  //
  // Assignments accumulate term after term, so deduping across all of them
  // offered everyone who had ever been staffed here — including people who
  // left the project terms ago. Scope to the current term's team instead,
  // falling back to the most recent staffed term so tasks on a finished
  // project can still be reassigned rather than facing an empty picker.
  //
  // A task carried over from an earlier term may still hold an assignee who has
  // since rolled off. TaskModal folds that task's own assignees into its picker
  // so they stay removable — which keeps the un-assign path working without
  // widening this project-wide list back out to every past member.
  const memberMap = new Map<string, string>();
  // Each member's staffed domain on this project, for the modal's "assign →
  // autofill Domain" step. First staffing row wins if someone spans domains.
  const domainByUserId = new Map<string, string>();
  for (const a of assignableAssignments(project.assignments, current?.id ?? null)) {
    const id = a.user.id;
    if (!memberMap.has(id)) {
      memberMap.set(id, fullName(a.user));
    }
    if (!domainByUserId.has(id)) {
      domainByUserId.set(id, a.domainId);
    }
  }
  // Term spans anchor the fixed one-week sprint grid (Sprint 1..N per term).
  // Oldest first, the order the grid walks them; the same set as the board's
  // term filter so every term option can populate the sprint picker. Both the
  // timeline and the task board read sprints off this same anchor.
  const termSpans = [...boardTermList]
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((t) => ({
      code: t.code,
      startsAt: t.startDate.toISOString(),
      endsAt: t.endDate.toISOString(),
    }));
  const boardOptions: TaskBoardOptions = {
    members: [...memberMap.entries()]
      .map(([id, name]) => ({
        id,
        name,
        photoUrl: photoByUserId.get(id) ?? null,
        domainId: domainByUserId.get(id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    domains: allDomains.map((d) => ({ id: d.id, name: d.displayName })),
    repoUrls: project.repoUrls,
    epics: boardEpics,
    stories: project.epics.flatMap((e) =>
      e.stories.map((st) => ({ id: st.id, title: st.title, epicId: e.id })),
    ),
    projectFiles: fileRows.map((f) => ({ id: f.id, title: f.title })),
    termSpans,
    terms: boardTerms,
    currentTermId: boardCurrentTermId,
  };

  // scopeRows fetched in Stage 2. Keyed by domainId+termId so the UI can
  // index in O(1) when building the grid.
  const scopeByCell = new Map<string, string>();
  for (const r of scopeRows) {
    scopeByCell.set(`${r.domainId}:${r.termId}`, r.scope);
  }
  // Grid: one entry per (declared domain, planned term) cell, with the
  // current scope text (empty string if no row exists).
  const domainScopeGrid = declaredDomains.flatMap((d) =>
    plannedTerms.map((t) => ({
      domainId: d.id,
      domainName: d.name,
      termId: t.id,
      termCode: t.code,
      scope: scopeByCell.get(`${d.id}:${t.id}`) ?? "",
    })),
  );
  // Derived fallback: union of (declared) + (bid domains) + (assignment domains).
  // Used only when declaredDomains is empty.
  const derivedDomainIds = new Set<string>();
  for (const b of bidDomains) derivedDomainIds.add(b.domainId);
  for (const a of project.assignments) {
    const dom = (a.domain as { id?: string } | null)?.id;
    if (dom) derivedDomainIds.add(dom);
  }
  const idToName = new Map(allDomains.map((d) => [d.id, d.displayName]));
  const derivedDomains = [...derivedDomainIds]
    .map((id) => ({ id, name: idToName.get(id) ?? "(unknown)" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // imageUrl may be an S3 key (uploaded via the project image control) or a
  // legacy pasted URL; resolve to a displayable src. The raw value stays on
  // project.imageUrl so the upload field round-trips the key on save.
  const imageUrlResolved = await resolvePhotoUrl(project.imageUrl);

  // Partnerships with derived active flag (same definition as
  // partner-access.ts: window open AND project not archived).
  const partnershipNow = new Date();
  const partnerships = project.partners.map((pp) => ({
    id: pp.id,
    startedAt: pp.startedAt ? pp.startedAt.toISOString() : null,
    endedAt: pp.endedAt ? pp.endedAt.toISOString() : null,
    active:
      project.status !== "Archived" &&
      (pp.startedAt === null || pp.startedAt <= partnershipNow) &&
      (pp.endedAt === null || pp.endedAt > partnershipNow),
    org: {
      id: pp.partnerOrg.id,
      name: pp.partnerOrg.name,
      logoUrl: pp.partnerOrg.logoUrl,
      website: pp.partnerOrg.website,
      contacts: pp.partnerOrg.memberships.map((m) => ({
        id: m.id,
        name: m.contact.name,
        email: m.contact.email,
        displayRole: m.role,
      })),
    },
  }));
  const hasActivePartner = partnerships.some((p) => p.active);
  // linkablePartnerOrgs, meetingRows, and activityRows all fetched in Stage 2.

  const upcomingMeetings = meetingRows.flatMap((m) =>
    m.selectedAt
      ? [
          {
            id: m.id,
            title: m.title,
            startsAt: m.selectedAt.toISOString(),
            durationMinutes: m.durationMinutes,
          },
        ]
      : [],
  );

  // activityRows is already mapped to the final shape by the async IIFE in Stage 2.
  const recentActivity = activityRows;

  // The Meetings tab's month grid. Gated on the tab: it costs a viewer lookup
  // and a meetings query, and every other tab would pay for a grid it never
  // renders. Deadlines reuse `epics`, already built for the timeline.
  const tabParam = new URL(request.url).searchParams.get("tab");
  // projectCalendar/projectDriveScope/projectInfra/infraConfigRow/
  // infraRequests/aiLineEnabled/chartStrings are all independent of each
  // other and need nothing beyond project/epics/roles from Stage 1 (plus
  // pageRows/fileRows from Stage 2 for the Drive scope below) — merged into
  // one wave instead of four separate round trips.
  const [
    projectCalendar,
    projectDriveScope,
    projectInfra,
    infraConfigRow,
    infraRequests,
    knownOrgs,
    aiLineEnabled,
    chartStrings,
  ] = await Promise.all([
    tabParam === "meetings"
      ? buildProjectCalendar({
          request,
          viewerId: auth.user.sub,
          projectId: project.id,
          calendarEmail: project.calendarEmail,
          epics,
        })
      : Promise.resolve(null),
    // Drive tab scope — loaded always so tab-switching is instant. Reuses the
    // Stage 2 pageRows/fileRows above as preloaded rows instead of
    // loadDriveScope re-querying pages/files for the same project.
    loadProjectDriveScope({
      userSub: auth.user.sub,
      projectId: project.id,
      projectName: project.name,
      projectIconEmoji: project.iconEmoji,
      request,
      preloadedProjectPages: pageRows,
      preloadedProjectFiles: fileRows,
    }),
    // Per-project infrastructure (Fly + Neon): config presence + cached
    // inventory + the project's change requests. View is open to anyone who
    // can see the project; config/requests are gated in the section by
    // canEdit (core||staffed).
    loadProjectInfra(params.id),
    prisma.project.findUnique({
      where: { id: params.id },
      select: {
        flyOrgSlug: true,
        flyAppNames: true,
        neonOrgId: true,
        neonProjectIds: true,
        infraEnabled: true,
        flyReadTokenEnc: true,
        flyWriteTokenEnc: true,
      },
    }),
    canEdit ? listProjectInfraRequests(params.id) : Promise.resolve([]),
    canEdit ? listKnownOrgs() : Promise.resolve({ fly: [], neon: [] }),
    // Progress tab's AI-line flag — independent of the status facts below.
    (async () =>
      isAiEnabled() &&
      (await isFeatureEnabled("project-tldr-ai", auth.user.sub, roles, request)))(),
    // Core-only: the project's chart string history, for the Payroll panel.
    // Everyone else gets an empty list rather than a filtered one — the rows
    // never reach the payload, the same reasoning as redactCoreOnlyProjectFields.
    canEditScope ? listProjectChartStrings(params.id) : Promise.resolve([]),
  ]);
  const infra = {
    config: {
      flyOrgSlug: infraConfigRow?.flyOrgSlug ?? null,
      flyAppNames: infraConfigRow?.flyAppNames ?? [],
      neonOrgId: infraConfigRow?.neonOrgId ?? null,
      neonProjectIds: infraConfigRow?.neonProjectIds ?? [],
      infraEnabled: infraConfigRow?.infraEnabled ?? true,
      hasFlyReadToken: !!infraConfigRow?.flyReadTokenEnc,
      hasFlyWriteToken: !!infraConfigRow?.flyWriteTokenEnc,
    },
    view: projectInfra,
    requests: infraRequests,
    knownOrgs,
    setupErrors: canEdit
      ? (new URL(request.url).searchParams.get("infraErrors") ?? "").split("\n").filter(Boolean)
      : [],
  };
  // ── Progress-tab status bar: deterministic work-status facts + the cached
  // AI summary's freshness. Facts come from the same task rows the board
  // already loaded (the current sprint is derived from term spans), so the bar
  // costs no extra query. aiTldrStale compares the current facts fingerprint
  // against the one the cached summary was written from; the client regenerates
  // when it differs.
  const statusNow = new Date();
  const statusFacts = computeProjectStatus(
    {
      projectStatus: project.status as ProjectWorkStatus,
      tasks: project.tasks.map((t) => ({
        id: t.id,
        status: t.status as TaskStatus,
        startsAt: t.startsAt,
        dueAt: t.dueAt,
        activityAt: t.activityAt,
      })),
      terms: termSpans,
    },
    statusNow,
  );
  // The named-task detail behind each chip — surfaced only in the bar's hover
  // tooltips, so it rides alongside the facts rather than in them (keeps the AI
  // fingerprint keyed on counts, not titles).
  const statusBreakdown = computeStatusBreakdown(
    project.tasks.map((t) => ({
      id: t.id,
      status: t.status as TaskStatus,
      title: t.title,
      priority: t.priority as Priority,
      startsAt: t.startsAt,
      dueAt: t.dueAt,
      activityAt: t.activityAt,
    })),
    statusNow,
  );
  const aiTldrStale =
    !project.aiTldrInputHash ||
    project.aiTldrInputHash !== factsFingerprint(statusFacts);

  return {
    infra,
    // Core-only fields are redacted server-side, not just hidden in JSX: this
    // payload goes to every viewer who can open the project, so gating only
    // the edit form would still ship the value to any lab member.
    project: redactCoreOnlyProjectFields(
      {
        id: project.id,
        name: project.name,
        iconEmoji: project.iconEmoji,
        description: project.description,
        status: project.status,
        calendarEmail: project.calendarEmail,
        teamGroupEmail: project.teamGroupEmail,
        imageUrl: project.imageUrl,
        imageUrlResolved,
        repoUrls: project.repoUrls,
        figmaUrls: project.figmaUrls,
        deploymentUrl: project.deploymentUrl,
        githubTeamSlug: project.githubTeamSlug,
        slackChannelName: project.slackChannelName,
        slackChannelId: project.slackChannelId,
        isPrivate: project.isPrivate,
        recordingPolicy: project.recordingPolicy,
        meetingNoteTemplate: project.meetingNoteTemplate,
        overviewPageId: project.overviewPageId,
        prdPageId: project.prdPageId,
        startTerm,
        // Full term set, chronological (earliest first) so the header can list
        // every term the project runs rather than just the start term.
        terms: [...plannedTerms]
          .reverse()
          .map((t) => ({ id: t.id, code: t.code })),
        isActiveThisTerm,
        actualTermCount: plannedTerms.length,
        termCount: project.termCount,
        partners: partnerships,
        domains: declaredDomains,
        derivedDomains,
        maintenancePlan: project.maintenancePlans[0]?.plan ?? null,
      },
      canEditScope,
    ),
    chartStrings,
    allDomainOptions: allDomains.map((d) => ({ id: d.id, name: d.displayName })),
    // sortKey rides along so the Overview challenge section can split the
    // grid into current vs future terms client-side.
    plannedTerms: plannedTerms.map((t) => ({
      id: t.id,
      code: t.code,
      sortKey: t.sortKey,
    })),
    pisByTerm,
    coreMembers,
    allTermOptions: [...allTerms]
      .sort((a, b) => b.sortKey - a.sortKey)
      .map((t) => ({ id: t.id, code: t.code })),
    domainScopeGrid,
    teams,
    termStatuses,
    upcomingMeetings,
    projectCalendar,
    recentActivity,
    epics,
    editableEpics,
    storyDependencies,
    epicDependencies,
    taskDependencies,
    timelineTerms: termSpans,
    tasks,
    boardOptions,
    statusFacts,
    statusBreakdown,
    aiTldr: project.aiTldr,
    aiTldrGeneratedAt: project.aiTldrGeneratedAt
      ? project.aiTldrGeneratedAt.toISOString()
      : null,
    aiTldrStale,
    aiLineEnabled,
    canEdit,
    canEditScope,
    canEditAssignmentLevel: core,
    canViewScope,
    hasActivePartner,
    linkablePartnerOrgs,
    canViewMentorshipTab,
    currentTerm: current
      ? { id: current.id, code: current.code, sortKey: current.sortKey }
      : null,
    collabToken,
    userName,
    currentUserId: auth.user.sub,
    presencePhotoUrl: presenceUser?.photoUrl ?? null,
    presenceSubtitle: presenceUser?.subtitle ?? null,
    projectDriveScope,
  };
}

export type ProjectDetailData = Exclude<Awaited<ReturnType<typeof loadProjectDetail>>, Response>;
