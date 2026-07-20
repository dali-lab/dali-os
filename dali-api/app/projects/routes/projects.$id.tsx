import { useEffect, useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  useSubmit,
} from "react-router";
import { CalendarDays, CalendarX, Check, Handshake, History, Pencil, Pin, X, Settings, Folder, FolderPlus, ChevronRight, ChevronDown, FileText, Info, Users, Paperclip, Plus, Trash2, Upload, Unlink } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { Tooltip } from "~/components/ui/IconButton";
import { EditableSection } from "~/components/EditableSection";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { uploadFileToS3, formatBytes } from "~/lib/upload-client";
import type { Route } from "./+types/projects.$id";
import { prisma } from "~/lib/db";
import { ensureProjectGroup } from "~/lib/groups";
import { ensureMeetingNotesFolder } from "~/lib/pages";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { formatDateShort, formatDateTime, fullName, UNKNOWN_LABEL } from "~/lib/display";
import { USER_NAME_SELECT } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { Avatar } from "~/components/ui/Avatar";
import { ProjectImageBanner } from "../components/ProjectImageBanner";
import { Markdown } from "~/components/Markdown";
import { parseSessionCookie } from "~/lib/cookies";
import { isCore, isProjectMember, canManageStaffing, currentTerm, isLabMentor } from "~/lib/roles";
import {
  linkProjectPartner,
  unlinkProjectPartner,
  updateProjectPartnerDates,
} from "~/partners/lib/partner-access";
import { getPresenceUser } from "~/lib/presence-user";
import { TaskBoard } from "../components/TaskBoard";
import { ProjectMentorshipTab } from "~/mentorship/components/ProjectMentorshipTab";
import {
  EpicsTimeline,
  type TimelineEpic,
  type EpicStatus,
} from "../components/EpicsTimeline";
import {
  EpicSprintManager,
  type EditableEpic,
  type EditableSprint,
} from "../components/EpicSprintManager";
import type {
  TaskBoardOptions,
  TaskCardModel,
  TaskStatus,
  Priority,
} from "../lib/task-board";

export const meta: Route.MetaFunction = ({ data }) => {
  const p = (data as { project?: { name: string } } | undefined)?.project;
  return [{ title: p ? `${p.name} · Projects · DALI OS` : "Project · DALI OS" }];
};

export const handle = {
  breadcrumb: (data: unknown) =>
    (data as { project?: { name: string } } | undefined)?.project?.name,
  headerAction: (data: unknown) => {
    const d = data as { project?: { id: string } } | undefined;
    if (!d?.project) return null;
    return (
      <Link
        to={`/projects/${d.project.id}/partner-view`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
      >
        <Handshake className="w-4 h-4" />
        Partner view
      </Link>
    );
  },
};

// Open a project document as a split-screen tab. This page renders inside a
// TabWorkspace iframe, so we ask the parent shell to open /documents/:id in a
// second pane beside the project (dali:openTabToSide → Layout). When somehow
// rendered standalone (no iframe), fall back to a normal same-tab navigation.
function openDocumentTab(pageId: string, label: string) {
  const url = `/documents/${pageId}`;
  if (typeof window !== "undefined" && window.self !== window.top) {
    window.parent.postMessage(
      { type: "dali:openTabToSide", url, label },
      window.location.origin,
    );
  } else if (typeof window !== "undefined") {
    window.location.assign(url);
  }
}

const STATUSES = ["Active", "Paused", "Archived"] as const;
type ProjectStatus = (typeof STATUSES)[number];

// "Scope" is no longer a public tab — its domain/term/challenge config moved
// into a settings popup (gated to Core/Admin/Staff). Public tabs are just the
// content views.
const TABS = ["overview", "work", "mentorship"] as const;
type Tab = (typeof TABS)[number];
function isTab(x: string | null): x is Tab {
  return x === "overview" || x === "work" || x === "mentorship";
}

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  work: "Work",
  mentorship: "Mentorship",
};

// Audit actions surfaced in the Overview "Recent activity" card. Restricted to
// actions whose metadata reliably carries a projectId — document.delete,
// projectFile.version, and projectFile.delete don't record one, so they can't
// be attributed to a project here without extra joins.
const PROJECT_ACTIVITY_ACTIONS = [
  "projectFile.create",
  "projectFile.partner-visibility",
  "page.partner-visibility",
  "project.assignment.level",
  "partner.project.link",
  "partner.project.update",
  "partner.project.unlink",
] as const;

const ACTIVITY_LABELS: Record<string, string> = {
  "projectFile.create": "added a file",
  "projectFile.partner-visibility": "changed a file's partner sharing",
  "page.partner-visibility": "changed a document's partner sharing",
  "project.assignment.level": "changed a team member's level",
  "partner.project.link": "linked a partner organization",
  "partner.project.update": "updated partnership dates",
  "partner.project.unlink": "unlinked a partner organization",
};

// Same shape as the home-tab notification timestamps.
function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      calendarEmail: true,
      teamGroupEmail: true,
      imageUrl: true,
      repoUrls: true,
      deploymentUrl: true,
      githubTeamSlug: true,
      slackChannelName: true,
      slackChannelId: true,
      chartStringType: true,
      chartString: true,
      overviewPageId: true,
      prdPageId: true,
      projectTerms: {
        select: { term: { select: { id: true, code: true, sortKey: true } } },
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
              users: {
                select: {
                  id: true,
                  displayRole: true,
                  user: { select: USER_NAME_SELECT },
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
          stories: {
            orderBy: { position: "asc" },
            select: { id: true, title: true, notes: true, status: true },
          },
        },
      },
      sprints: {
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          name: true,
          startsAt: true,
          endsAt: true,
          status: true,
          epicId: true,
        },
      },
      tasks: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          position: true,
          dueAt: true,
          epicId: true,
          sprintId: true,
          checklist: true,
          githubIssueNumber: true,
          githubIssueUrl: true,
          createdAt: true,
          createdBy: { select: USER_NAME_SELECT },
          domain: { select: { id: true, displayName: true } },
          assignees: {
            select: {
              user: { select: USER_NAME_SELECT },
            },
          },
        },
      },
      // Declared domains for this project — editable from the Overview tab.
      // Distinct from per-assignment domains (which describe who's actually
      // staffed in which domain this term).
      domains: {
        select: { domain: { select: { id: true, displayName: true } } },
      },
    },
  });
  if (!project) throw new Response("Not found", { status: 404 });

  // Backfill the two default, undeletable meeting-note folders (idempotent —
  // no-ops once they exist) so every project's Documents block always shows
  // them, including projects created before this feature existed.
  await Promise.all([
    ensureMeetingNotesFolder(project.id, "Team", auth.user.sub),
    ensureMeetingNotesFolder(project.id, "Partner", auth.user.sub),
  ]);

  // Project documents — non-archived Pages scoped to this project's
  // workspace, top-level and one level of children (folders only ever nest
  // one level deep — see the 2-level cap on Page.parentPageId).
  const pageRows = await prisma.page.findMany({
    where: {
      workspaceType: "Project",
      workspaceId: project.id,
      archivedAt: null,
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      kind: true,
      parentPageId: true,
      systemKey: true,
      partnerVisible: true,
    },
  });
  const childrenByParent = new Map<string, typeof pageRows>();
  for (const p of pageRows) {
    if (!p.parentPageId) continue;
    const list = childrenByParent.get(p.parentPageId);
    if (list) list.push(p);
    else childrenByParent.set(p.parentPageId, [p]);
  }
  const toDocumentDto = (d: (typeof pageRows)[number]) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    isSystem: d.systemKey !== null,
    partnerVisible: d.partnerVisible,
  });
  const documents = pageRows
    .filter((p) => p.parentPageId === null)
    .map((p) => ({
      ...toDocumentDto(p),
      children: (childrenByParent.get(p.id) ?? []).map(toDocumentDto),
    }));

  // Pinned Overview/PRD docs — rendered at the top of the Documents block.
  // Only shown while the referenced page still exists non-archived in this
  // project's workspace (pageRows is exactly that set).
  const workspacePageIds = new Set(pageRows.map((p) => p.id));
  const pinnedDocuments = [
    { id: project.overviewPageId, label: "Overview" },
    { id: project.prdPageId, label: "PRD" },
  ].flatMap((d) =>
    d.id && workspacePageIds.has(d.id) ? [{ id: d.id, label: d.label }] : [],
  );

  // Project files — standalone uploads with their current version.
  // Tags are edited in the file/document editor, not on this list.
  const fileRows = await prisma.projectFile.findMany({
    where: { projectId: project.id, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      partnerVisible: true,
      currentVersion: { select: { fileName: true, sizeBytes: true } },
      _count: { select: { versions: true } },
    },
  });
  const files = fileRows.map((f) => ({
    id: f.id,
    title: f.title,
    fileName: f.currentVersion?.fileName ?? null,
    sizeBytes: f.currentVersion?.sizeBytes ?? null,
    versionCount: f._count.versions,
    partnerVisible: f.partnerVisible,
  }));

  // Content edits (name/status, description, details, docs/files, epics/
  // sprints/tasks) are open to Core/Admin *and* anyone staffed on this project
  // in any term. Scope/domain settings stay Core/Admin only (canEditScope).
  const core = await isCore(auth.user.sub);
  const canEditScope = core;
  const canEdit = core || (await isProjectMember(auth.user.sub, params.id));
  // The Scope/challenge settings popup is visible to Core, Admin, or staffing
  // leads. Editing still requires canEditScope (isCore) — the action enforces that.
  const canViewScope = canEditScope || (await canManageStaffing(auth.user.sub));
  // Mentorship tab is for the mentor collective (lab mentors + Core). Mentees
  // never see it on the project page.
  const canViewMentorshipTab = core || (await isLabMentor(auth.user.sub));

  // Collab editor wiring (same as the hiring routes): session cookie is the
  // WebSocket auth token; userName labels the presence cursor.
  const collabToken = parseSessionCookie(request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
    auth.user.email;
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName);
  const userName = presenceUser?.name ?? fallbackName;

  // Timeline span: prefer the epic's explicit startsAt/endsAt; fall back to
  // the min/max of its sprint dates when either is unset. When the epic has
  // sprints, expand the bar to cover the sprint union so the parent epic bar
  // never disappears while child sprint bars are visible.
  const epics: TimelineEpic[] = project.epics.map((e) => {
    const epicSprints = project.sprints
      .filter((s) => s.epicId === e.id)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const sprintStarts = epicSprints.map((s) => s.startsAt.getTime());
    const sprintEnds = epicSprints.map((s) => s.endsAt.getTime());
    const sprintStartMs = sprintStarts.length ? Math.min(...sprintStarts) : null;
    const sprintEndMs = sprintEnds.length ? Math.max(...sprintEnds) : null;

    let startMs = e.startsAt?.getTime() ?? sprintStartMs;
    let endMs = e.endsAt?.getTime() ?? sprintEndMs;
    if (sprintStartMs != null && startMs != null) startMs = Math.min(startMs, sprintStartMs);
    if (sprintEndMs != null && endMs != null) endMs = Math.max(endMs, sprintEndMs);

    return {
      id: e.id,
      title: e.title,
      status: e.status as EpicStatus,
      startsAt: startMs != null ? new Date(startMs).toISOString() : null,
      endsAt: endMs != null ? new Date(endMs).toISOString() : null,
      sprintCount: epicSprints.length,
      sprints: epicSprints.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status as TimelineEpic["sprints"][number]["status"],
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      })),
    };
  });

  const editableEpics: EditableEpic[] = project.epics.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    status: e.status as EditableEpic["status"],
    startsAt: e.startsAt ? e.startsAt.toISOString() : null,
    endsAt: e.endsAt ? e.endsAt.toISOString() : null,
    descriptionDocId: e.descriptionDocId,
    stories: e.stories.map((s) => ({
      id: s.id,
      title: s.title,
      notes: s.notes,
      status: s.status as EditableEpic["stories"][number]["status"],
    })),
  }));

  const sprints: EditableSprint[] = project.sprints.map((s) => ({
    id: s.id,
    name: s.name,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    status: s.status as EditableSprint["status"],
    epicId: s.epicId,
  }));

  const tasks: TaskCardModel[] = project.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    priority: t.priority as Priority,
    position: t.position,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    epicId: t.epicId,
    sprintId: t.sprintId,
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
    createdBy: { id: t.createdBy.id, name: fullName(t.createdBy) },
    createdAt: t.createdAt.toISOString(),
  }));

  // Board option lists for the TaskModal: members assignable on this project
  // (deduped across terms — same person across multiple terms shows once) and
  // every active domain.
  const memberMap = new Map<string, string>();
  for (const a of project.assignments) {
    const id = a.user.id;
    if (!memberMap.has(id)) {
      memberMap.set(id, fullName(a.user));
    }
  }
  const sprintFilterOrder = { Active: 0, Planned: 1, Closed: 2 } as const;
  const boardOptions: TaskBoardOptions = {
    members: [...memberMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    domains: (
      await prisma.domain.findMany({
        where: { active: true },
        orderBy: { displayName: "asc" },
        select: { id: true, displayName: true },
      })
    ).map((d) => ({ id: d.id, name: d.displayName })),
    repoUrls: project.repoUrls,
    sprints: [...sprints]
      .sort(
        (a, b) =>
          sprintFilterOrder[a.status] - sprintFilterOrder[b.status] ||
          a.startsAt.localeCompare(b.startsAt),
      )
      .map((s) => ({ id: s.id, name: s.name, status: s.status })),
    epics: project.epics.map((e) => ({ id: e.id, title: e.title })),
  };

  // Per-epic task progress for the epic list rows + timeline tooltips.
  // Cancelled tasks don't count toward either side.
  const taskCountsByEpic: Record<string, { done: number; total: number }> = {};
  for (const t of project.tasks) {
    if (!t.epicId || t.status === "Cancelled") continue;
    const counts = (taskCountsByEpic[t.epicId] ??= { done: 0, total: 0 });
    counts.total += 1;
    if (t.status === "Done") counts.done += 1;
  }

  // Team grouped by term, newest term first. Current = highest sortKey.
  //
  // For Core viewers we also surface per-assignment editing context:
  //   - eligibilityLevel: ceiling enforced by /api/projects/assignments/:id/level
  //   - activeMenteeCount: a P3→lower demotion is blocked while this > 0
  // Both lookups are skipped for non-Core viewers (they see read-only badges).
  const eligibilityCeilings = new Map<string, string>();
  const menteeCounts = new Map<string, number>();
  if (core && project.assignments.length > 0) {
    const eligibilityPairs = new Map<string, { userId: string; domainId: string }>();
    for (const a of project.assignments) {
      eligibilityPairs.set(`${a.userId}:${a.domainId}`, {
        userId: a.userId,
        domainId: a.domainId,
      });
    }
    const mentorUserIds = [...new Set(project.assignments.map((a) => a.userId))];
    const [eligibilityRows, mentorRows] = await Promise.all([
      prisma.domainEligibility.findMany({
        where: { OR: [...eligibilityPairs.values()] },
        select: { userId: true, domainId: true, level: true },
      }),
      // Over-fetch: any MentorshipPair on this project where any of our
      // assignees is the mentor. We bucket client-side by the exact
      // (mentorUserId, termId, domainId) tuple the endpoint checks.
      prisma.mentorshipPair.findMany({
        where: { projectId: project.id, mentorUserId: { in: mentorUserIds } },
        select: { mentorUserId: true, termId: true, domainId: true },
      }),
    ]);
    for (const e of eligibilityRows) {
      eligibilityCeilings.set(`${e.userId}:${e.domainId}`, e.level);
    }
    for (const m of mentorRows) {
      const key = `${m.mentorUserId}:${m.termId}:${m.domainId}`;
      menteeCounts.set(key, (menteeCounts.get(key) ?? 0) + 1);
    }
  }

  type TeamMember = {
    assignmentId: string;
    userId: string;
    name: string;
    photoUrl: string | null;
    domain: string;
    domainId: string;
    level: string;
    eligibilityLevel: string | null;
    activeMenteeCount: number;
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
      eligibilityLevel: eligibilityCeilings.get(`${a.userId}:${a.domainId}`) ?? null,
      activeMenteeCount:
        menteeCounts.get(`${a.userId}:${a.termId}:${a.domainId}`) ?? 0,
    });
  }
  const teams = [...teamByTerm.values()].sort((a, b) => b.sortKey - a.sortKey);

  const termStatuses = [...project.termStatuses].sort(
    (a, b) => b.term.sortKey - a.term.sortKey,
  );

  // Domain editor option list + fallback-from-staffing data. The detail page
  // displays declared domains directly; if none are declared, it falls back
  // to the union of domains seen on this project's bids + assignments so a
  // project that's actively being staffed still shows its domain footprint.
  const [allDomains, bidDomains, allTerms] = await Promise.all([
    prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
    prisma.staffingPreference.findMany({
      where: { projectId: project.id },
      select: { domainId: true },
      distinct: ["domainId"],
    }),
    prisma.term.findMany({
      orderBy: { sortKey: "desc" },
      select: { id: true, code: true },
    }),
  ]);
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

  // Start term is derived as the earliest term in the set (lowest sortKey),
  // not a stored field. Null when the project has no terms yet.
  const startTerm =
    plannedTerms.length > 0 ? plannedTerms[plannedTerms.length - 1] : null;

  // Active-this-term is derived from membership: the project is active iff the
  // current term is in its set. Distinct from the manual status enum
  // (Paused/Archived), which the lead still controls explicitly.
  const current = await currentTerm();
  const isActiveThisTerm =
    current !== null && plannedTerms.some((t) => t.id === current.id);

  // Fetch all scope rows for this project (small N — at most |declared| ×
  // termCount, both single-digit in practice). Keyed by domainId+termId so
  // the UI can index in O(1) when building the grid.
  const scopeRows = await prisma.projectDomainScope.findMany({
    where: { projectId: project.id },
    select: { domainId: true, termId: true, scope: true },
  });
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
      contacts: pp.partnerOrg.users.map((u) => ({
        id: u.id,
        name: fullName(u.user),
        displayRole: u.displayRole,
      })),
    },
  }));
  const hasActivePartner = partnerships.some((p) => p.active);
  // Orgs not yet linked, for the Core-only link picker.
  const linkablePartnerOrgs = core
    ? await prisma.partnerOrg.findMany({
        where: { projects: { none: { projectId: project.id } } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  // Next upcoming meetings for this project (Overview card). Bounded to 5;
  // cancelled and unscheduled (selectedAt null) meetings are excluded. The
  // model has no location/URL field — rows link to /calendar instead.
  const meetingRows = await prisma.scheduledMeeting.findMany({
    where: {
      projectId: project.id,
      status: { not: "Cancelled" },
      selectedAt: { gte: new Date() },
    },
    orderBy: { selectedAt: "asc" },
    take: 5,
    select: { id: true, title: true, selectedAt: true, durationMinutes: true },
  });
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

  // Recent project-scoped audit activity, editors only. See
  // PROJECT_ACTIVITY_ACTIONS for why some project events aren't included.
  let recentActivity: {
    id: string;
    action: string;
    actorName: string;
    createdAt: string;
  }[] = [];
  if (canEdit) {
    const activityRows = await prisma.auditLog.findMany({
      where: {
        action: { in: [...PROJECT_ACTIVITY_ACTIONS] },
        metadata: { path: ["projectId"], equals: project.id },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, userId: true, createdAt: true },
    });
    const actorIds = [
      ...new Set(activityRows.flatMap((r) => (r.userId ? [r.userId] : []))),
    ];
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: USER_NAME_SELECT,
        })
      : [];
    const actorNameById = new Map(actors.map((u) => [u.id, fullName(u)]));
    recentActivity = activityRows.map((r) => ({
      id: r.id,
      action: r.action,
      actorName: (r.userId ? actorNameById.get(r.userId) : null) ?? UNKNOWN_LABEL,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      calendarEmail: project.calendarEmail,
      teamGroupEmail: project.teamGroupEmail,
      imageUrl: project.imageUrl,
      imageUrlResolved,
      repoUrls: project.repoUrls,
      deploymentUrl: project.deploymentUrl,
      githubTeamSlug: project.githubTeamSlug,
      slackChannelName: project.slackChannelName,
      slackChannelId: project.slackChannelId,
      chartStringType: project.chartStringType,
      chartString: project.chartString,
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
    },
    allDomainOptions: allDomains.map((d) => ({ id: d.id, name: d.displayName })),
    // sortKey rides along so the Overview challenge section can split the
    // grid into current vs future terms client-side.
    plannedTerms: plannedTerms.map((t) => ({
      id: t.id,
      code: t.code,
      sortKey: t.sortKey,
    })),
    allTermOptions: allTerms,
    domainScopeGrid,
    teams,
    termStatuses,
    documents,
    pinnedDocuments,
    files,
    upcomingMeetings,
    recentActivity,
    epics,
    editableEpics,
    sprints,
    tasks,
    boardOptions,
    taskCountsByEpic,
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
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  // Content edits are open to Core/Admin or anyone staffed on the project;
  // scope/domain settings (scopesBulk, domains, terms) stay Core/Admin only.
  const core = await isCore(auth.user.sub);
  if (!core && !(await isProjectMember(auth.user.sub, params.id))) {
    return { error: "You don't have permission to edit this project." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "details";

  const SCOPE_INTENTS = ["scopesBulk", "domains", "terms"];
  if (SCOPE_INTENTS.includes(intent) && !core) {
    return { error: "Only Core or Admin can change project settings." };
  }

  // Partner links — Core/Admin only, via the shared helpers so validation
  // and audit stay identical to the Core Hub org pages.
  const PARTNER_INTENTS = ["partner-link", "partner-end", "partner-unlink"];
  if (PARTNER_INTENTS.includes(intent)) {
    if (!core) {
      return { error: "Only Core or Admin can manage partner organizations." };
    }
    const actor = { actorUserId: auth.user.sub, request };
    if (intent === "partner-link") {
      const partnerOrgId = (form.get("partnerOrgId") as string | null) ?? "";
      if (!partnerOrgId) return { error: "Select an organization." };
      const result = await linkProjectPartner(
        { projectId: params.id, partnerOrgId },
        actor,
      );
      return "error" in result ? result : redirect(`/projects/${params.id}`);
    }
    const projectPartnerId = (form.get("projectPartnerId") as string | null) ?? "";
    const existing = await prisma.projectPartner.findFirst({
      where: { id: projectPartnerId, projectId: params.id },
      select: { id: true, startedAt: true },
    });
    if (!existing) return { error: "Partnership not found." };
    if (intent === "partner-end") {
      const result = await updateProjectPartnerDates(
        { projectPartnerId, startedAt: existing.startedAt, endedAt: new Date() },
        actor,
      );
      return "error" in result ? result : redirect(`/projects/${params.id}`);
    }
    const result = await unlinkProjectPartner(projectPartnerId, actor);
    return "error" in result ? result : redirect(`/projects/${params.id}`);
  }

  // Header form: name + status only.
  if (intent === "header") {
    const name = (form.get("name") as string | null)?.trim() ?? "";
    const status = (form.get("status") as string | null) ?? "";
    if (!name) return { error: "Project name is required." };
    if (!STATUSES.includes(status as ProjectStatus)) {
      return { error: "Invalid status." };
    }
    await prisma.project.update({
      where: { id: params.id },
      data: { name, status: status as ProjectStatus },
    });
    await ensureProjectGroup(params.id, name);
    return redirect(`/projects/${params.id}`);
  }

  // Description segment: its own form/submit so it doesn't blank the other
  // detail fields.
  if (intent === "description") {
    const descriptionRaw = (form.get("description") as string | null)?.trim() ?? "";
    await prisma.project.update({
      where: { id: params.id },
      data: { description: descriptionRaw === "" ? null : descriptionRaw },
    });
    return redirect(`/projects/${params.id}`);
  }

  // Image-only update: the banner saves immediately on upload (its own fetcher),
  // independent of the details form. Same gate as above (already checked).
  if (intent === "update-image") {
    const imageUrlRaw = (form.get("imageUrl") as string | null)?.trim() ?? "";
    await prisma.project.update({
      where: { id: params.id },
      data: { imageUrl: imageUrlRaw === "" ? null : imageUrlRaw },
    });
    return redirect(`/projects/${params.id}`);
  }

  // Per-(domain, term) scope cells. Bulk write: the form names cells as
  // "scope:<domainId>:<termId>" so a single Save commits every cell at
  // once. Empty values delete the row to keep the table tidy. A stale
  // domainId/termId is silently dropped rather than erroring so a partial
  // form (e.g. domain unlisted after first render) doesn't 500.
  if (intent === "scopesBulk") {
    type CellWrite = { domainId: string; termId: string; scope: string };
    const writes: CellWrite[] = [];
    for (const [key, value] of form.entries()) {
      if (!key.startsWith("scope:")) continue;
      const [, domainId, termId] = key.split(":");
      if (!domainId || !termId) continue;
      writes.push({ domainId, termId, scope: String(value).trim() });
    }
    if (writes.length === 0) {
      return redirect(`/projects/${params.id}`);
    }
    const ops = writes.map(({ domainId, termId, scope }) =>
      scope === ""
        ? prisma.projectDomainScope.deleteMany({
            where: { projectId: params.id, domainId, termId },
          })
        : prisma.projectDomainScope.upsert({
            where: {
              projectId_domainId_termId: {
                projectId: params.id,
                domainId,
                termId,
              },
            },
            update: { scope, updatedById: auth.user.sub },
            create: {
              projectId: params.id,
              domainId,
              termId,
              scope,
              updatedById: auth.user.sub,
            },
          }),
    );
    await prisma.$transaction(ops);
    return redirect(`/projects/${params.id}`);
  }

  // Declared domains for this project. Full-replacement: incoming set wins.
  // Filtered down to active, real Domain ids so a stale dropdown value can't
  // create orphan rows. Wrapped in a transaction so a partial failure leaves
  // the project's domain list untouched.
  if (intent === "domains") {
    const incoming = form.getAll("domainId").map((v) => String(v));
    const valid = incoming.length
      ? await prisma.domain.findMany({
          where: { id: { in: incoming }, active: true },
          select: { id: true },
        })
      : [];
    const ids = valid.map((d) => d.id);
    await prisma.$transaction([
      prisma.projectDomain.deleteMany({ where: { projectId: params.id } }),
      ...(ids.length
        ? [
            prisma.projectDomain.createMany({
              data: ids.map((domainId) => ({ projectId: params.id, domainId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
    return redirect(`/projects/${params.id}`);
  }

  // Project term set. Full-replacement: the incoming set of termIds wins, so
  // the same handler covers both adding and removing terms. Filtered to real
  // Term ids so a stale value can't create an orphan row. The start term and
  // active-this-term are derived from this set, not stored. Mirrors the
  // `domains` handler above.
  if (intent === "terms") {
    const incoming = form.getAll("termId").map((v) => String(v));
    const valid = incoming.length
      ? await prisma.term.findMany({
          where: { id: { in: incoming } },
          select: { id: true },
        })
      : [];
    const ids = valid.map((t) => t.id);
    await prisma.$transaction([
      prisma.projectTerm.deleteMany({ where: { projectId: params.id } }),
      ...(ids.length
        ? [
            prisma.projectTerm.createMany({
              data: ids.map((termId) => ({ projectId: params.id, termId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
    return redirect(`/projects/${params.id}`);
  }

  // Details form: calendar email, repos, deployment. (Description, name/status,
  // and the image banner are saved by their own segments above.)
  const calendarEmailRaw = (form.get("calendarEmail") as string | null)?.trim() ?? "";
  const repoUrlsRaw = (form.get("repoUrls") as string | null) ?? "";
  const deploymentUrlRaw = (form.get("deploymentUrl") as string | null)?.trim() ?? "";
  const termCountRaw = (form.get("termCount") as string | null) ?? "";
  const githubTeamRaw = (form.get("githubTeamSlug") as string | null)?.trim() ?? "";
  const slackChannelRaw = (form.get("slackChannelName") as string | null)?.trim() ?? "";

  // Normalize to a GitHub-safe team slug: lowercase, non-alphanumerics → single
  // hyphens, trimmed. Empty clears the field (automation then skips).
  const githubTeamSlug =
    githubTeamRaw === ""
      ? null
      : githubTeamRaw
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

  // Slack channel name: lowercase, hyphens, ≤80 (Slack's channel-name rules), to
  // match what the finalize step would derive. Empty clears it. Editing here is
  // metadata-only — the channel is get-or-created when an automation runs.
  const slackChannelName =
    slackChannelRaw === ""
      ? null
      : slackChannelRaw
          .toLowerCase()
          .replace(/[^a-z0-9-_\s]/g, "")
          .trim()
          .replace(/\s+/g, "-")
          .slice(0, 80);

  // repoUrls textarea: one URL per line, blanks dropped.
  const repoUrls = repoUrlsRaw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // termCount is the *expected* span length (≥1), an independent target; the
  // actual terms live in the ProjectTerm set (intent=terms). Blank/invalid
  // falls back to 1 rather than erroring the whole form.
  const termCount = Math.max(1, Math.floor(Number(termCountRaw)) || 1);

  // Payroll chart string — Core-only. Project members posting these fields
  // are silently ignored rather than 403'd to keep the form forgiving.
  const chartStringFields: { chartStringType?: string | null; chartString?: string | null } = {};
  if (core) {
    const chartStringTypeRaw = (form.get("chartStringType") as string | null)?.trim() ?? "";
    const chartStringRaw = (form.get("chartString") as string | null)?.trim() ?? "";
    chartStringFields.chartStringType = chartStringTypeRaw === "" ? null : chartStringTypeRaw;
    chartStringFields.chartString = chartStringRaw === "" ? null : chartStringRaw;
  }

  await prisma.project.update({
    where: { id: params.id },
    data: {
      calendarEmail: calendarEmailRaw === "" ? null : calendarEmailRaw,
      repoUrls,
      deploymentUrl: deploymentUrlRaw === "" ? null : deploymentUrlRaw,
      termCount,
      githubTeamSlug,
      slackChannelName,
      ...chartStringFields,
    },
  });
  return redirect(`/projects/${params.id}`);
}

export default function ProjectDetail() {
  const {
    project,
    teams,
    documents,
    pinnedDocuments,
    files,
    upcomingMeetings,
    recentActivity,
    epics,
    editableEpics,
    sprints,
    tasks,
    boardOptions,
    taskCountsByEpic,
    allDomainOptions,
    plannedTerms,
    allTermOptions,
    domainScopeGrid,
    canEdit,
    canEditScope,
    canEditAssignmentLevel,
    canViewScope,
    hasActivePartner,
    linkablePartnerOrgs,
    canViewMentorshipTab,
    currentTerm,
    collabToken,
    userName,
    currentUserId,
    presencePhotoUrl,
    presenceSubtitle,
  } = useLoaderData() as LoaderData;
  const actionData = useActionData<typeof action>();
  const [scopeSettingsOpen, setScopeSettingsOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerNames = project.partners.map((p) => p.org.name);

  const tabParam = searchParams.get("tab");
  // A ?tab=mentorship deep link from a non-mentor would otherwise render an
  // empty body (valid tab, but its content branch is gated) — treat it as
  // invalid and fall back to Overview.
  const tab: Tab =
    isTab(tabParam) && (tabParam !== "mentorship" || canViewMentorshipTab)
      ? tabParam
      : "overview";
  const setTab = (next: Tab) => {
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true },
    );
  };

  const page = (
    <div className="flex flex-col gap-4">
      <PresenceBar className="self-end" />

      {/* Overview header — always on top, not behind a tab */}
      <ProjectHeader
        project={project}
        partnerNames={partnerNames}
        canEdit={canEdit}
      />

      {/* Tab bar. Each section now owns its own edit button — there's no
          page-level edit mode left to clear when switching tabs. */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.filter(
          (t) => t !== "mentorship" || canViewMentorshipTab,
        ).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-accent-coral text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        {/* Scope/challenge config lives behind this gear, visible only to
            Core/Admin/Staff. */}
        {canViewScope && (
          <Tooltip label="Project settings" className="ml-auto -mb-px">
            <button
              type="button"
              onClick={() => setScopeSettingsOpen(true)}
              aria-label="Project settings"
              className="inline-flex items-center justify-center p-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              title="Project settings & challenges"
            >
              <Settings className="w-4 h-4" />
            </button>
          </Tooltip>
        )}
      </div>

      {/* Page-level action errors — above the tab content so a failed save
          (e.g. the header form) is visible from any tab. The settings modal
          keeps its own inline copy. */}
      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      {tab === "overview" && (
        <OverviewTab
          project={project}
          teams={teams}
          documents={documents}
          pinnedDocuments={pinnedDocuments}
          files={files}
          upcomingMeetings={upcomingMeetings}
          recentActivity={recentActivity}
          canEdit={canEdit}
          canEditFinance={canEditScope}
          canEditAssignmentLevel={canEditAssignmentLevel}
          canManagePartners={canEditScope}
          hasActivePartner={hasActivePartner}
          linkablePartnerOrgs={linkablePartnerOrgs}
          domainScopeGrid={domainScopeGrid}
          plannedTerms={plannedTerms}
          currentTerm={currentTerm}
        />
      )}

      {/* Scope & challenges, now a settings popup gated to Core/Admin/Staff. */}
      {canViewScope && (
        <Modal
          open={scopeSettingsOpen}
          onClose={() => setScopeSettingsOpen(false)}
          labelledBy="scope-settings-title"
          containerClassName="bg-card rounded-2xl shadow-xl w-full max-w-4xl p-5 sm:p-6 my-auto max-h-[85vh] overflow-y-auto"
        >
          <ModalHeader
            titleId="scope-settings-title"
            title="Project settings"
            subtitle="Declared domains, planned terms, and the per-domain challenge for each term."
            onClose={() => setScopeSettingsOpen(false)}
            closeLabel="Close scope settings"
          />
          <ScopeTab
            project={project}
            allDomainOptions={allDomainOptions}
            plannedTerms={plannedTerms}
            allTermOptions={allTermOptions}
            domainScopeGrid={domainScopeGrid}
            canEdit={canEditScope}
            actionError={actionData?.error}
          />
        </Modal>
      )}

      {tab === "work" && (
        // Work tab keys off the raw edit permission, not the page-level
        // Edit-mode toggle: epics/sprints/tasks each gate their own inline
        // edit affordances, so there's nothing to "turn on" first.
        <WorkTab
          projectId={project.id}
          epics={epics}
          editableEpics={editableEpics}
          sprints={sprints}
          tasks={tasks}
          boardOptions={boardOptions}
          taskCountsByEpic={taskCountsByEpic}
          canEdit={canEdit}
          collabToken={collabToken}
          userName={userName}
          currentUserId={currentUserId}
        />
      )}

      {tab === "mentorship" && canViewMentorshipTab && (
        <ProjectMentorshipTab
          projectId={project.id}
          currentTermId={currentTerm?.id ?? null}
        />
      )}
    </div>
  );

  return collabToken ? (
    <PresenceProvider
      pageId={`project:${project.id}`}
      token={collabToken}
      userName={userName}
      userId={currentUserId}
      photoUrl={presencePhotoUrl}
      subtitle={presenceSubtitle}
    >
      {page}
    </PresenceProvider>
  ) : (
    page
  );
}

// loader returns `redirect()` (a Response) on the auth-fail branches; the
// component only ever renders with the data branch, so narrow it out here.
type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;

function ProjectHeader({
  project,
  partnerNames,
  canEdit,
}: {
  project: LoaderData["project"];
  partnerNames: string[];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // Actual terms vs the expected span: when they differ, show "N of M" so a
  // partially-scheduled project reads as such. termCount is the expected target.
  const actualTermCount = project.actualTermCount;
  const termCountLabel =
    actualTermCount === project.termCount
      ? `${project.termCount} ${project.termCount === 1 ? "term" : "terms"}`
      : `${actualTermCount} of ${project.termCount} terms`;

  const termsLabel =
    project.terms.length > 0
      ? project.terms.map((t) => t.code).join(", ")
      : "No terms yet";

  const subtitle = (
    <p className="text-sm text-muted-foreground mt-1">
      {termsLabel}
      {" · "}
      {termCountLabel}
    </p>
  );

  return (
    <header className="flex flex-col gap-4">
      <ProjectImageBanner
        projectId={project.id}
        projectName={project.name}
        initialPreviewUrl={project.imageUrlResolved}
        canEdit={canEdit}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div key={resetKey} className="flex items-center gap-2 flex-wrap">
            {editing && canEdit ? (
              <Form
                method="post"
                ref={formRef}
                className="flex items-center gap-2 flex-wrap"
              >
                <input type="hidden" name="intent" value="header" />
                <input
                  name="name"
                  defaultValue={project.name}
                  aria-label="Project name"
                  autoFocus
                  className="font-heading text-xl font-bold text-foreground px-2 py-1 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
                <select
                  name="status"
                  defaultValue={project.status}
                  aria-label="Project status"
                  className="text-xs px-2 py-1 border border-border rounded-full bg-background text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Form>
            ) : (
              <>
                <h1 className="font-heading text-2xl font-bold text-foreground">
                  {project.name}
                </h1>
                <StatusBadge status={project.status} />
                {project.status === "Active" && !project.isActiveThisTerm && (
                  <Tooltip label="Status is Active, but the current term isn't in this project's term set — it isn't running right now.">
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-border bg-muted/50 text-muted-foreground font-medium">
                      Not running this term
                    </span>
                  </Tooltip>
                )}
              </>
            )}

            {/* Domain chips at a glance. Falls back to the derived set (bids
                + assignments) so a project that hasn't declared anything yet
                still telegraphs its staffing footprint. */}
            {!editing &&
              (project.domains.length > 0 ? (
                <DomainChips items={project.domains} />
              ) : project.derivedDomains.length > 0 ? (
                <DomainChips items={project.derivedDomains} muted />
              ) : null)}
          </div>

          {canEdit && (
            <div className="flex items-center gap-1.5 shrink-0">
              {editing ? (
                <>
                  <Tooltip label="Cancel">
                    <button
                      type="button"
                      onClick={() => {
                        setResetKey((k) => k + 1);
                        setEditing(false);
                      }}
                      aria-label="Cancel"
                      className="inline-flex items-center justify-center p-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Save">
                    <button
                      type="button"
                      onClick={() => {
                        if (formRef.current) submit(formRef.current);
                        setEditing(false);
                      }}
                      aria-label="Save"
                      className="inline-flex items-center justify-center p-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                </>
              ) : (
                <Tooltip label="Edit">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Edit project name and status"
                    className="inline-flex items-center justify-center p-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              )}
            </div>
          )}
        </div>
        {subtitle}
      </div>
    </header>
  );
}

function DescriptionSegment({
  description,
  canEdit,
}: {
  description: string | null;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Description"
      icon={<FileText className="w-4 h-4" />}
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) =>
        editing ? (
          <Form method="post" ref={formRef} className="flex flex-col gap-1.5">
            <input type="hidden" name="intent" value="description" />
            <textarea
              name="description"
              rows={6}
              defaultValue={description ?? ""}
              placeholder="Add a short description… (Markdown supported)"
              className="px-2 py-1.5 text-sm font-mono border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Supports Markdown — **bold**, headings, lists, links, `code`.
            </p>
          </Form>
        ) : description ? (
          <Markdown>{description}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No description.
          </p>
        )
      }
    </EditableSection>
  );
}

// Declared-domain editor for the project. Multi-select via checkboxes (3–8
// active domains; click-to-toggle reads faster than a multi-select). Saves
// the full set on every toggle so the row order doesn't matter and a stale
// optimistic state can't accumulate. When no domains are declared and the
// project has bids/assignments, the derived union is shown read-only as a
// hint so the user can see what staffing has implied so far.
function DomainsSegment({
  declared,
  derived,
  allDomains,
  canEdit,
}: {
  declared: { id: string; name: string }[];
  derived: { id: string; name: string }[];
  allDomains: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Domains"
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          // Controlled chip toggles. The previous markup wrapped a hidden
          // checkbox in a styled <label> and keyed the chip's "selected"
          // styling off the prop-derived `isOn` — clicking the label
          // toggled the checkbox in the DOM but `isOn` (a render closure)
          // never re-read it, so the chip looked unchanged. Now an explicit
          // local Set tracks selection, the chip is a <button>, and the
          // form's `domainId` entries are emitted as hidden inputs at
          // submit time. `resetKey` (bumped by EditableSection on Cancel)
          // is the dependency that resets state back to `declared`.
          <DomainsChipsEditor
            key={resetKey}
            formRef={formRef}
            initialSelectedIds={declared.map((d) => d.id)}
            allDomains={allDomains}
            derived={derived}
            declaredCount={declared.length}
          />
        ) : declared.length > 0 ? (
          <DomainChips items={declared} />
        ) : derived.length > 0 ? (
          <>
            <DomainChips items={derived} muted />
            <p className="text-xs text-muted-foreground mt-2">
              Derived from current bids and assignments — no domains have
              been declared on the project yet.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground italic">No domains.</p>
        )
      }
    </EditableSection>
  );
}

function DomainsChipsEditor({
  formRef,
  initialSelectedIds,
  allDomains,
  derived,
  declaredCount,
}: {
  formRef: React.MutableRefObject<HTMLFormElement | null>;
  initialSelectedIds: string[];
  allDomains: { id: string; name: string }[];
  derived: { id: string; name: string }[];
  declaredCount: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );
  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <Form method="post" ref={formRef} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="domains" />
      {/* Selected ids are submitted as repeated form fields the action
          collects via form.getAll("domainId"). */}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="domainId" value={id} />
      ))}
      <div className="flex flex-wrap gap-2">
        {allDomains.map((d) => {
          const isOn = selected.has(d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              aria-pressed={isOn}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm cursor-pointer transition-colors ${
                isOn
                  ? "bg-accent-coral/15 border-accent-coral/40 text-foreground"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.name}
            </button>
          );
        })}
      </div>
      {derived.length > 0 && declaredCount === 0 && (
        <p className="text-xs text-muted-foreground">
          No domains declared yet — current bids and assignments suggest:{" "}
          <span className="text-foreground">
            {derived.map((d) => d.name).join(", ")}
          </span>
          .
        </p>
      )}
    </Form>
  );
}

// Project terms — the editable term set (source of truth for which terms the
// project runs). Same click-to-toggle, save-the-full-set pattern as Domains;
// the action's intent=terms handler full-replaces ProjectTerm rows. The start
// term and "active this term" are derived from this set, so no separate
// start-term field is edited here. `expected` (termCount) is edited in the
// Details section and shown here only as a target for context.
function TermsSegment({
  selected,
  allTerms,
  expected,
  canEdit,
}: {
  selected: { id: string; code: string }[];
  allTerms: { id: string; code: string }[];
  expected: number;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Terms"
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          <TermsChipsEditor
            key={resetKey}
            formRef={formRef}
            initialSelectedIds={selected.map((t) => t.id)}
            allTerms={allTerms}
            expected={expected}
          />
        ) : selected.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700 border border-blue-100"
              >
                {t.code}
              </span>
            ))}
            {selected.length !== expected && (
              <span className="text-xs text-muted-foreground self-center">
                {selected.length} of {expected} expected
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No terms yet{expected > 0 ? ` — ${expected} expected` : ""}.
          </p>
        )
      }
    </EditableSection>
  );
}

function TermsChipsEditor({
  formRef,
  initialSelectedIds,
  allTerms,
  expected,
}: {
  formRef: React.MutableRefObject<HTMLFormElement | null>;
  initialSelectedIds: string[];
  allTerms: { id: string; code: string }[];
  expected: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );
  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <Form method="post" ref={formRef} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="terms" />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="termId" value={id} />
      ))}
      <div className="flex flex-wrap gap-2">
        {allTerms.map((t) => {
          const isOn = selected.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              aria-pressed={isOn}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm cursor-pointer transition-colors ${
                isOn
                  ? "bg-accent-coral/15 border-accent-coral/40 text-foreground"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.code}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected.size} selected · {expected} expected. The start term is the
        earliest selected; the project shows as active when the current term is
        selected.
      </p>
    </Form>
  );
}

// Calendar email + image URL + term count + repo URLs. One form posting
// intent=details with the full field set, so the action handler stays
// unchanged. Section-level Save submits; Cancel reverts via the wrapper.
function DetailsSegment({
  project,
  canEdit,
  canEditFinance,
}: {
  project: LoaderData["project"];
  canEdit: boolean;
  canEditFinance: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Project details"
      icon={<Info className="w-4 h-4" />}
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) => (
        <Form method="post" ref={formRef} className="flex flex-col gap-4 w-full">
          <input type="hidden" name="intent" value="details" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Calendar email</span>
              {editing ? (
                <input
                  name="calendarEmail"
                  type="email"
                  defaultValue={project.calendarEmail ?? ""}
                  placeholder="projectname@dali.dartmouth.edu"
                  className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
              ) : (
                <span className="px-2 py-1.5 text-sm text-foreground">
                  {project.calendarEmail ?? "—"}
                </span>
              )}
            </label>

            {/* Team email group — provisioned by the staffing "Create team email
                group" automation; read-only here (not lead-editable). */}
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Team email group</span>
              <span className="px-2 py-1.5 text-sm">
                {project.teamGroupEmail ? (
                  <a
                    href={`mailto:${project.teamGroupEmail}`}
                    className="text-accent-coral hover:underline break-all"
                  >
                    {project.teamGroupEmail}
                  </a>
                ) : (
                  <span className="text-muted-foreground">
                    Not created yet — run staffing finalize.
                  </span>
                )}
              </span>
            </label>


            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">GitHub team</span>
              {editing ? (
                <input
                  name="githubTeamSlug"
                  type="text"
                  defaultValue={project.githubTeamSlug ?? ""}
                  placeholder="project-team-name"
                  className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
              ) : (
                <span className="px-2 py-1.5 text-sm text-foreground">
                  {project.githubTeamSlug ?? "—"}
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Slack channel</span>
              {editing ? (
                <input
                  name="slackChannelName"
                  type="text"
                  defaultValue={project.slackChannelName ?? ""}
                  placeholder="project-name"
                  className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
              ) : project.slackChannelName && project.slackChannelId ? (
                // Only the channel *id* resolves reliably in Slack's
                // app_redirect; a bare name renders as plain text below.
                <a
                  href={`https://slack.com/app_redirect?channel=${project.slackChannelId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-1.5 text-sm text-accent-coral hover:underline break-all"
                >
                  {project.slackChannelName}
                </a>
              ) : (
                <span className="px-2 py-1.5 text-sm text-foreground">
                  {project.slackChannelName ?? "—"}
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                Terms required (planned span)
              </span>
              {editing ? (
                <input
                  name="termCount"
                  type="number"
                  min={1}
                  defaultValue={project.termCount}
                  className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
              ) : (
                <span className="px-2 py-1.5 text-sm text-foreground">
                  {project.termCount}{" "}
                  {project.termCount === 1 ? "term" : "terms"}
                </span>
              )}
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              Repositories (one URL per line)
            </span>
            {editing ? (
              <textarea
                name="repoUrls"
                rows={3}
                defaultValue={project.repoUrls.join("\n")}
                placeholder="https://github.com/dali-lab/…"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 font-mono"
              />
            ) : project.repoUrls.length > 0 ? (
              <ul className="flex flex-col gap-1 px-2 py-1.5">
                {project.repoUrls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-accent-coral hover:underline break-all"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="px-2 py-1.5 text-sm text-muted-foreground">
                —
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Deployment</span>
            {editing ? (
              <input
                name="deploymentUrl"
                type="url"
                defaultValue={project.deploymentUrl ?? ""}
                placeholder="https://projectname.fly.dev"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 font-mono"
              />
            ) : project.deploymentUrl ? (
              <a
                href={project.deploymentUrl}
                target="_blank"
                rel="noreferrer"
                className="px-2 py-1.5 text-sm text-accent-coral hover:underline break-all"
              >
                {project.deploymentUrl}
              </a>
            ) : (
              <span className="px-2 py-1.5 text-sm text-muted-foreground">—</span>
            )}
          </label>

          {/* Payroll chart string — surfaced and editable only to Core (action
              handler enforces the same gate). Read-only to project members. */}
          {canEditFinance && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-border">
              <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                <span className="text-muted-foreground font-medium">
                  Payroll
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Chart string type</span>
                {editing ? (
                  <input
                    name="chartStringType"
                    type="text"
                    defaultValue={project.chartStringType ?? ""}
                    placeholder="e.g. Grant, Department"
                    className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                  />
                ) : (
                  <span className="px-2 py-1.5 text-sm text-foreground">
                    {project.chartStringType ?? "—"}
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Full chart string</span>
                {editing ? (
                  <input
                    name="chartString"
                    type="text"
                    defaultValue={project.chartString ?? ""}
                    placeholder="full GL chart string"
                    className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 font-mono"
                  />
                ) : (
                  <span className="px-2 py-1.5 text-sm text-foreground font-mono break-all">
                    {project.chartString ?? "—"}
                  </span>
                )}
              </label>
            </div>
          )}
        </Form>
      )}
    </EditableSection>
  );
}

// Per-(domain, term) scope grid. One Edit button for the whole section;
// Save commits every cell at once via intent=scopesBulk. Empty cells in
// the submitted set delete their row server-side.
function DomainScopesSegment({
  domains,
  terms,
  grid,
  canEdit,
}: {
  domains: { id: string; name: string }[];
  terms: { id: string; code: string }[];
  grid: {
    domainId: string;
    domainName: string;
    termId: string;
    termCode: string;
    scope: string;
  }[];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const cell = (domainId: string, termId: string): string =>
    grid.find((c) => c.domainId === domainId && c.termId === termId)?.scope ??
    "";

  return (
    <EditableSection
      title="Domain challenges"
      description="Free-text challenge brief for each declared domain in each planned term."
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) => (
        <Form method="post" ref={formRef} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="scopesBulk" />
          {terms.map((t) => (
            <div key={t.id} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">{t.code}</h3>
              <div className="flex flex-col gap-3">
                {domains.map((d) => {
                  const value = cell(d.id, t.id);
                  return (
                    <div
                      key={`${d.id}:${t.id}`}
                      className="rounded-md border border-border p-2 flex flex-col gap-1"
                    >
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {d.name}
                      </span>
                      {editing ? (
                        <textarea
                          name={`scope:${d.id}:${t.id}`}
                          defaultValue={value}
                          rows={3}
                          placeholder="+ Add challenge"
                          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 resize-y"
                        />
                      ) : value ? (
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {value}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          No challenge.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </Form>
      )}
    </EditableSection>
  );
}

function DomainChips({
  items,
  muted = false,
}: {
  items: { id: string; name: string }[];
  muted?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((d) => (
        <span
          key={d.id}
          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${
            muted
              ? "bg-muted text-muted-foreground"
              : "bg-blue-50 text-blue-700 border border-blue-100"
          }`}
        >
          {d.name}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: (typeof STATUSES)[number] }) {
  const palette: Record<(typeof STATUSES)[number], string> = {
    Active: "bg-accent-teal/15 text-accent-teal border-accent-teal/40",
    Paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/40",
    Archived: "bg-muted/50 text-muted-foreground border-border",
  };
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${palette[status]}`}
    >
      {status}
    </span>
  );
}

function TeamSection({
  teams,
  canEdit,
  currentTermCode,
}: {
  teams: LoaderData["teams"];
  canEdit: boolean;
  currentTermCode: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  // teams is pre-sorted newest term first by the loader.
  const visible = showAll ? teams : teams.slice(0, 1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="w-4 h-4" /> Team
        </h2>
        {teams.length > 1 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs font-medium text-accent-coral hover:underline"
          >
            {showAll ? "Show less" : `Show all (${teams.length} terms)`}
          </button>
        )}
      </div>
      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No team assignments yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((team) => (
            <div key={team.code}>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">
                {team.code}
                {/* "Current" only when this group's term IS the current term —
                    the newest group may be a past term on a wrapped project. */}
                {currentTermCode !== null && team.code === currentTermCode && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-accent-teal/40 bg-accent-teal/15 text-accent-teal">
                    Current
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {team.members.map((m) => (
                  <span
                    key={m.assignmentId}
                    className="text-xs px-2 py-1 rounded-md text-foreground inline-flex items-center gap-1.5"
                  >
                    <Avatar photoUrl={m.photoUrl} name={m.name} size="xs" />
                    {m.name}
                    <span className="text-muted-foreground">· {m.domain}</span>
                    {canEdit ? (
                      <TeamLevelEditor member={m} />
                    ) : (
                      <span className="text-muted-foreground">{m.level}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const LEVEL_OPTIONS: ("P1" | "P2" | "P3")[] = ["P1", "P2", "P3"];
const LEVEL_RANK: Record<"P1" | "P2" | "P3", number> = { P1: 1, P2: 2, P3: 3 };

function TeamLevelEditor({
  member,
}: {
  member: LoaderData["teams"][number]["members"][number];
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const ceilingRank = member.eligibilityLevel
    ? LEVEL_RANK[member.eligibilityLevel as "P1" | "P2" | "P3"]
    : 0;
  const currentRank = LEVEL_RANK[member.level as "P1" | "P2" | "P3"];
  const blockedByMentees = member.activeMenteeCount > 0;

  const value = (fetcher.formData?.get("level") as string | null) ?? member.level;
  const busy = fetcher.state !== "idle";
  const error = fetcher.data?.error;

  function disabledReason(opt: "P1" | "P2" | "P3"): string | null {
    if (opt === member.level) return null;
    if (LEVEL_RANK[opt] > ceilingRank) {
      return member.eligibilityLevel
        ? `Eligible only up to ${member.eligibilityLevel} in ${member.domain}. Promote first.`
        : `No ${member.domain} eligibility. Promote first.`;
    }
    if (blockedByMentees && LEVEL_RANK[opt] < currentRank) {
      return `Mentoring ${member.activeMenteeCount} mentee${member.activeMenteeCount === 1 ? "" : "s"}. Reassign first.`;
    }
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label={`Level for ${member.name} in ${member.domain}`}
        className="text-xs bg-transparent text-muted-foreground rounded border border-transparent hover:border-border focus:border-border focus:outline-none px-0.5"
        value={value}
        disabled={busy}
        onChange={(e) => {
          const next = e.target.value;
          if (next === member.level) return;
          fetcher.submit(
            { level: next },
            {
              method: "post",
              action: `/api/projects/assignments/${member.assignmentId}/level`,
              encType: "application/json",
            },
          );
        }}
      >
        {LEVEL_OPTIONS.map((opt) => {
          const reason = disabledReason(opt);
          return (
            <option key={opt} value={opt} disabled={reason !== null} title={reason ?? undefined}>
              {opt}
              {reason ? " (locked)" : ""}
            </option>
          );
        })}
      </select>
      {error && (
        <span className="text-[10px] leading-tight text-destructive" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function OverviewTab({
  project,
  teams,
  documents,
  pinnedDocuments,
  files,
  upcomingMeetings,
  recentActivity,
  canEdit,
  canEditFinance,
  canEditAssignmentLevel,
  canManagePartners,
  hasActivePartner,
  linkablePartnerOrgs,
  domainScopeGrid,
  plannedTerms,
  currentTerm,
}: {
  project: LoaderData["project"];
  teams: LoaderData["teams"];
  documents: LoaderData["documents"];
  pinnedDocuments: LoaderData["pinnedDocuments"];
  files: LoaderData["files"];
  upcomingMeetings: LoaderData["upcomingMeetings"];
  recentActivity: LoaderData["recentActivity"];
  canEdit: boolean;
  canEditFinance: boolean;
  canEditAssignmentLevel: boolean;
  canManagePartners: boolean;
  hasActivePartner: boolean;
  linkablePartnerOrgs: LoaderData["linkablePartnerOrgs"];
  domainScopeGrid: LoaderData["domainScopeGrid"];
  plannedTerms: LoaderData["plannedTerms"];
  currentTerm: LoaderData["currentTerm"];
}) {
  const [showFutureChallenges, setShowFutureChallenges] = useState(false);

  // The current term's per-domain challenge, read-only on Overview. Edited in
  // the Scope settings popup. Only non-empty cells for the current term show.
  const currentChallenges = currentTerm
    ? domainScopeGrid.filter(
        (c) => c.termId === currentTerm.id && c.scope.trim() !== "",
      )
    : [];

  // Future planned terms with non-empty challenge text, soonest first —
  // collapsed under the current term so members can see where the project is
  // headed without the Core-only settings gear. Read-only, like the above.
  const futureChallengeGroups = currentTerm
    ? plannedTerms
        .filter((t) => t.sortKey > currentTerm.sortKey)
        .sort((a, b) => a.sortKey - b.sortKey)
        .map((t) => ({
          termId: t.id,
          termCode: t.code,
          cells: domainScopeGrid.filter(
            (c) => c.termId === t.id && c.scope.trim() !== "",
          ),
        }))
        .filter((g) => g.cells.length > 0)
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Description — its own segment on top, separate from Project details */}
      <DescriptionSegment description={project.description} canEdit={canEdit} />

      {/* Challenge for the current term, per declared domain (read-only). */}
      {currentTerm &&
        (currentChallenges.length > 0 || futureChallengeGroups.length > 0) && (
          <section className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">
                Challenge{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  · {currentTerm.code}
                </span>
              </h3>
              {futureChallengeGroups.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFutureChallenges((v) => !v)}
                  className="text-xs font-medium text-accent-coral hover:underline"
                >
                  {showFutureChallenges
                    ? "Hide upcoming terms"
                    : `Upcoming terms (${futureChallengeGroups.length})`}
                </button>
              )}
            </div>
            {currentChallenges.length > 0 ? (
              <div className="space-y-3">
                {currentChallenges.map((c) => (
                  <div key={c.domainId}>
                    <div className="text-xs font-medium text-muted-foreground">
                      {c.domainName}
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">
                      {c.scope}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No challenge for {currentTerm.code} yet.
              </p>
            )}
            {showFutureChallenges &&
              futureChallengeGroups.map((g) => (
                <div key={g.termId} className="mt-4 pt-3 border-t border-border">
                  <div className="text-xs font-semibold text-muted-foreground mb-2">
                    {g.termCode}
                  </div>
                  <div className="space-y-3">
                    {g.cells.map((c) => (
                      <div key={c.domainId}>
                        <div className="text-xs font-medium text-muted-foreground">
                          {c.domainName}
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">
                          {c.scope}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </section>
        )}

      {/* Partner organizations funding this project. Core manages links. */}
      <PartnersSection
        partners={project.partners}
        linkablePartnerOrgs={linkablePartnerOrgs}
        canManage={canManagePartners}
      />

      {/* Project details. Editable as one section; commits via intent=details
          which expects the full field set. Section-level Save submits and
          closes; Cancel reverts (the wrapper remounts the body which resets
          defaultValue inputs). */}
      <DetailsSegment
        project={project}
        canEdit={canEdit}
        canEditFinance={canEditFinance}
      />

      {/* Team — read-only summary, separate from the editable details. */}
      <section className="bg-card border border-border rounded-lg p-4">
        <TeamSection
          teams={teams}
          canEdit={canEditAssignmentLevel}
          currentTermCode={currentTerm?.code ?? null}
        />
      </section>

      {/* Next scheduled meetings for this project. Hidden entirely when there
          are none — no empty-state card. */}
      {upcomingMeetings.length > 0 && (
        <section className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4" /> Meetings
          </h2>
          <div className="flex flex-col divide-y divide-border">
            {upcomingMeetings.map((m) => (
              <Link
                key={m.id}
                to="/calendar"
                className="py-2.5 flex items-center justify-between gap-3 text-sm group"
              >
                <span className="truncate font-medium text-foreground group-hover:text-accent-coral">
                  {m.title}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {formatDateTime(m.startsAt)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Documents — collab-doc pages; rows + Add open the doc as a split-screen
          tab beside the project (via the TabWorkspace shell). */}
      <DocumentsBlock
        projectId={project.id}
        documents={documents}
        pinnedDocuments={pinnedDocuments}
        canEdit={canEdit}
        hasActivePartner={hasActivePartner}
      />

      {/* Files — standalone uploads with versions. Tags are edited in the file editor. */}
      <FilesBlock
        projectId={project.id}
        files={files}
        canEdit={canEdit}
        hasActivePartner={hasActivePartner}
      />

      {/* Recent project-scoped audit activity — editors only (the loader
          returns an empty list otherwise). Read-only. */}
      {canEdit && recentActivity.length > 0 && (
        <section className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
            <History className="w-4 h-4" /> Recent activity
          </h2>
          <ul className="flex flex-col gap-2">
            {recentActivity.map((a) => (
              <li key={a.id} className="text-xs text-muted-foreground">
                <span className="text-foreground font-medium">{a.actorName}</span>{" "}
                {ACTIVITY_LABELS[a.action] ?? a.action}
                <span className="text-muted-foreground/70">
                  {" "}
                  · {relativeTime(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ScopeTab({
  project,
  allDomainOptions,
  plannedTerms,
  allTermOptions,
  domainScopeGrid,
  canEdit,
  actionError,
}: {
  project: LoaderData["project"];
  allDomainOptions: LoaderData["allDomainOptions"];
  plannedTerms: LoaderData["plannedTerms"];
  allTermOptions: LoaderData["allTermOptions"];
  domainScopeGrid: LoaderData["domainScopeGrid"];
  canEdit: boolean;
  actionError?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {actionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionError}
        </div>
      )}

      {/* Declared domains — editable; if none declared the derived set from
          assignments + bids is shown as a fallback so a freshly-created
          project that's mid-staffing still has visible domain context. */}
      <DomainsSegment
        declared={project.domains}
        derived={project.derivedDomains}
        allDomains={allDomainOptions}
        canEdit={canEdit}
      />

      {/* Project terms — the editable term set. Start term and active-this-term
          are derived from this set; termCount (Details) is the expected target. */}
      <TermsSegment
        selected={plannedTerms}
        allTerms={allTermOptions}
        expected={project.termCount}
        canEdit={canEdit}
      />

      {/* Per-domain, per-term scope grid. One cell per (declared domain ×
          planned term). Empty cell = no scope written yet. Auto-saves on
          blur; clearing a cell to empty deletes the row. */}
      {project.domains.length > 0 && plannedTerms.length > 0 && (
        <DomainScopesSegment
          domains={project.domains}
          terms={plannedTerms}
          grid={domainScopeGrid}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

function PartnersSection({
  partners,
  linkablePartnerOrgs,
  canManage,
}: {
  partners: LoaderData["project"]["partners"];
  linkablePartnerOrgs: LoaderData["linkablePartnerOrgs"];
  canManage: boolean;
}) {
  const [linking, setLinking] = useState(false);

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Handshake className="w-4 h-4" /> Partners
        </h2>
        {canManage && linkablePartnerOrgs.length > 0 && (
          <button
            type="button"
            onClick={() => setLinking((v) => !v)}
            className="text-xs font-medium text-accent-coral hover:underline"
          >
            + Link organization
          </button>
        )}
      </div>

      {linking && canManage && (
        <Form method="post" className="flex flex-wrap items-end gap-3 bg-muted/20 rounded-lg p-3 mb-3">
          <input type="hidden" name="intent" value="partner-link" />
          <select
            name="partnerOrgId"
            required
            className="flex-1 min-w-[220px] rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">Select an organization…</option>
            {linkablePartnerOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-dark-blue text-white text-sm font-medium px-4 py-2 hover:opacity-90 transition"
          >
            Link
          </button>
        </Form>
      )}

      {partners.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No partner organizations linked.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {partners.map((p) => (
            <div key={p.id} className="py-2.5 flex items-center gap-3">
              {p.org.logoUrl ? (
                <img
                  src={p.org.logoUrl}
                  alt=""
                  className="w-8 h-8 rounded object-contain bg-background border border-border flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded bg-brand-tint text-dark-blue flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {p.org.name.slice(0, 1)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {canManage ? (
                    <Link
                      to={`/partners/${p.org.id}`}
                      className="text-sm font-medium text-foreground hover:underline leading-none"
                    >
                      {p.org.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-foreground leading-none">
                      {p.org.name}
                    </span>
                  )}
                  {/* Partnership lifecycle at a glance: ended partnerships keep
                      their record (partner-end), active ones show their start. */}
                  {p.endedAt ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/50 text-muted-foreground">
                      Ended {formatDateShort(p.endedAt)}
                    </span>
                  ) : p.active && p.startedAt ? (
                    <span className="text-xs text-muted-foreground">
                      since {formatDateShort(p.startedAt)}
                    </span>
                  ) : null}
                </div>
                {p.org.contacts.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {p.org.contacts
                      .map((c) => (c.displayRole ? `${c.name} (${c.displayRole})` : c.name))
                      .join(", ")}
                  </div>
                )}
              </div>
              {canManage && !p.endedAt && (
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (
                      !window.confirm(
                        `End the partnership with ${p.org.name}? The record and its dates are kept — this only marks the partnership as ended today.`,
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="intent" value="partner-end" />
                  <input type="hidden" name="projectPartnerId" value={p.id} />
                  <Tooltip label="End partnership (keeps the record)">
                    <button
                      type="submit"
                      aria-label="End partnership"
                      className="inline-flex items-center justify-center p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex-shrink-0"
                    >
                      <CalendarX className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                </Form>
              )}
              {canManage && (
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (
                      !window.confirm(
                        `Unlink ${p.org.name}? This erases the partnership record entirely — use "End partnership" instead to keep the history.`,
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="intent" value="partner-unlink" />
                  <input type="hidden" name="projectPartnerId" value={p.id} />
                  <Tooltip label="Unlink organization (erases the record)">
                    <button
                      type="submit"
                      aria-label="Unlink organization"
                      className="inline-flex items-center justify-center p-1.5 rounded-md text-destructive hover:bg-destructive/10 flex-shrink-0"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                </Form>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DocumentsBlock({
  projectId,
  documents,
  pinnedDocuments,
  canEdit,
  hasActivePartner,
}: {
  projectId: string;
  documents: LoaderData["documents"];
  pinnedDocuments: LoaderData["pinnedDocuments"];
  canEdit: boolean;
  hasActivePartner: boolean;
}) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Folders default open so the (usually few) default folders' contents are
  // visible without an extra click; new folders created this session are
  // added here too (see createFolder).
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(documents.filter((d) => d.kind === "Folder").map((d) => d.id)),
  );
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // A document's title is edited in its own split-screen tab, which has its
  // own loader — it can't touch this route's data directly. The shell relays
  // a `dali:documentTitleChanged` postMessage to every open tab (see
  // DocumentEditor's onTitleChange + Layout.tsx); revalidate here so the row
  // label updates without waiting for the user to leave and reopen the doc.
  useEffect(() => {
    const knownIds = new Set(
      documents.flatMap((d) => [d.id, ...d.children.map((c) => c.id)]),
    );
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; pageId?: string } | undefined;
      if (data?.type !== "dali:documentTitleChanged") return;
      if (!data.pageId || !knownIds.has(data.pageId)) return;
      revalidator.revalidate();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [documents, revalidator]);

  // Share/unshare a page with the project's partner org(s). Persisted via
  // its own API route; the badge state comes back through the loader.
  async function togglePartnerVisible(id: string, next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${id}/partner-visible`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerVisible: next }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to update sharing");
      }
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // Add document: create an "Untitled" page immediately, then open it as a
  // split-screen tab beside the project. The title is renamed inline in the
  // editor (auto-saves), so there's no separate title prompt first. When
  // parentPageId is set, the document is nested under that folder.
  async function createDocument(parentPageId?: string) {
    setBusy(true);
    setError(null);
    try {
      const title = "Untitled";
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, parentPageId }),
      });
      const b = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !b.id) throw new Error(b.error ?? "Failed to create document");
      openDocumentTab(b.id, title);
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function createFolder() {
    const title = window.prompt("Folder name");
    if (!title || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), kind: "Folder" }),
      });
      const b = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !b.id) throw new Error(b.error ?? "Failed to create folder");
      setExpanded((prev) => new Set(prev).add(b.id!));
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDocument(id: string, title: string) {
    if (!window.confirm(`Delete document "${title}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to delete");
      }
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function DocRow({ doc, indent }: { doc: LoaderData["documents"][number]["children"][number]; indent: boolean }) {
    return (
      <div className={`py-2.5 flex items-center justify-between gap-3 text-sm ${indent ? "pl-6" : ""}`}>
        <button
          type="button"
          onClick={() => openDocumentTab(doc.id, doc.title)}
          className="truncate text-left font-medium text-foreground hover:text-accent-coral"
        >
          {doc.title}
        </button>
        <div className="flex items-center gap-3 flex-shrink-0">
          {doc.partnerVisible && !canEdit && (
            <Tooltip label="Shared with partner — partners on this project can open and edit this page">
              <span className="flex items-center text-accent-teal">
                <Handshake className="w-3.5 h-3.5" />
              </span>
            </Tooltip>
          )}
          {canEdit && (hasActivePartner || doc.partnerVisible) && (
            <Tooltip
              label={
                doc.partnerVisible
                  ? "Shared with partner — click to stop sharing"
                  : "Share with partner"
              }
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void togglePartnerVisible(doc.id, !doc.partnerVisible)}
                // Accessible name must stay exactly "Shared with partner" /
                // "Share with partner": it's the toggle's only name now that the
                // label is icon-only, and it's the contract partner-portal.spec
                // matches on via getByRole. The tooltip carries the extra hint.
                aria-label={doc.partnerVisible ? "Shared with partner" : "Share with partner"}
                className={`flex items-center disabled:opacity-60 ${
                  doc.partnerVisible
                    ? "text-accent-teal"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Handshake className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip label="Delete document">
              <button
                type="button"
                disabled={busy}
                onClick={() => void deleteDocument(doc.id, doc.title)}
                aria-label="Delete document"
                className="text-destructive hover:text-destructive/80 disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Folder className="w-4 h-4" /> Documents
        </h2>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Tooltip label="New folder">
              <button
                type="button"
                disabled={busy}
                onClick={() => void createFolder()}
                aria-label="New folder"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-60"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip label="Add document">
              <button
                type="button"
                disabled={busy}
                onClick={() => void createDocument()}
                aria-label="Add document"
                className="p-1 rounded text-accent-coral hover:bg-accent-coral/10 disabled:opacity-60"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No documents yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {/* Pinned Overview/PRD pages on top — same open-as-tab flow as the
              rows below, marked like the DEFAULT-folder chip. */}
          {pinnedDocuments.map((d) => (
            <div key={d.id} className="py-2.5 flex items-center gap-1.5 text-sm">
              <Pin className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => openDocumentTab(d.id, d.label)}
                className="truncate text-left font-medium text-foreground hover:text-accent-coral"
              >
                {d.label}
              </button>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 flex-shrink-0">
                Pinned
              </span>
            </div>
          ))}
          {documents.map((doc) =>
            doc.kind === "Folder" ? (
              <div key={doc.id} className="py-2.5 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(doc.id)}
                    className="flex items-center gap-1.5 text-left font-medium text-foreground min-w-0"
                  >
                    {expanded.has(doc.id) ? (
                      <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                    )}
                    <Folder className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate">{doc.title}</span>
                    {doc.isSystem && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 flex-shrink-0">
                        Default
                      </span>
                    )}
                  </button>
                  {canEdit && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Tooltip label="Add document">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void createDocument(doc.id)}
                          aria-label="Add document"
                          className="p-1 rounded text-accent-coral hover:bg-accent-coral/10 disabled:opacity-60"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                      {!doc.isSystem && (
                        <button
                          type="button"
                          disabled={busy || doc.children.length > 0}
                          title={
                            doc.children.length > 0
                              ? "Move or delete the documents inside this folder first"
                              : "Delete folder"
                          }
                          aria-label="Delete folder"
                          onClick={() => void deleteDocument(doc.id, doc.title)}
                          className="p-1 rounded text-destructive hover:text-destructive/80 disabled:opacity-60"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {expanded.has(doc.id) &&
                  (doc.children.length === 0 ? (
                    <p className="pl-6 text-xs text-muted-foreground italic">Empty</p>
                  ) : (
                    <div className="flex flex-col divide-y divide-border">
                      {doc.children.map((child) => (
                        <DocRow key={child.id} doc={child} indent />
                      ))}
                    </div>
                  ))}
              </div>
            ) : (
              <DocRow key={doc.id} doc={doc} indent={false} />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function FilesBlock({
  projectId,
  files,
  canEdit,
  hasActivePartner,
}: {
  projectId: string;
  files: LoaderData["files"];
  canEdit: boolean;
  hasActivePartner: boolean;
}) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Share/unshare a file with the project's partner org(s) — same pattern as
  // DocumentsBlock.togglePartnerVisible. Persisted via its own API route; the
  // badge state comes back through the loader.
  async function togglePartnerVisible(id: string, next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${id}/partner-visible`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerVisible: next }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to update sharing");
      }
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  // When set, the chosen file is added as a new version of this file id;
  // otherwise it creates a new ProjectFile.
  const versionForId = useRef<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const targetId = versionForId.current;
    versionForId.current = null;

    setBusy(true);
    setError(null);
    try {
      const meta = await uploadFileToS3(picked, `project-files/${projectId}`);
      if (targetId) {
        const res = await fetch(`/api/files/${targetId}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "version", ...meta }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? "Failed to upload new version");
        }
      } else {
        const res = await fetch(`/api/projects/${projectId}/files`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: picked.name, ...meta }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? "Failed to add file");
        }
      }
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFile(id: string, title: string) {
    if (!window.confirm(`Delete file "${title}"? All versions will be removed.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to delete");
      }
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <input ref={fileInputRef} type="file" className="hidden" onChange={onPick} />
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Paperclip className="w-4 h-4" /> Files
        </h2>
        {canEdit && (
          <Tooltip label={busy ? "Uploading…" : "Add file"}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                versionForId.current = null;
                fileInputRef.current?.click();
              }}
              aria-label={busy ? "Uploading…" : "Add file"}
              className="p-1 rounded text-accent-coral hover:bg-accent-coral/10 disabled:opacity-60"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No files yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {files.map((f) => (
            <div key={f.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
              <Link to={`/documents/file/${f.id}`} className="min-w-0 truncate hover:text-accent-coral">
                <span className="text-foreground font-medium">{f.title}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {f.fileName}
                  {f.sizeBytes != null ? ` · ${formatBytes(f.sizeBytes)}` : ""}
                  {f.versionCount > 1 ? ` · v${f.versionCount}` : ""}
                </span>
              </Link>
              <div className="flex items-center gap-2 flex-shrink-0">
                {f.partnerVisible && !canEdit && (
                  <Tooltip label="Shared with partner — partners on this project can download this file">
                    <span className="flex items-center text-accent-teal">
                      <Handshake className="w-3.5 h-3.5" />
                    </span>
                  </Tooltip>
                )}
                {canEdit && (hasActivePartner || f.partnerVisible) && (
                  <Tooltip
                    label={
                      f.partnerVisible
                        ? "Shared with partner — click to stop sharing"
                        : "Share with partner"
                    }
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void togglePartnerVisible(f.id, !f.partnerVisible)}
                      aria-label={f.partnerVisible ? "Shared file with partner" : "Share file with partner"}
                      className={`p-1 rounded disabled:opacity-60 ${
                        f.partnerVisible
                          ? "text-accent-teal"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      <Handshake className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                )}
                {canEdit && (
                  <>
                    <Tooltip label="New version">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          versionForId.current = f.id;
                          fileInputRef.current?.click();
                        }}
                        aria-label="New version"
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-60"
                      >
                        <Upload className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip label="Delete file">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteFile(f.id, f.title)}
                        aria-label="Delete file"
                        className="p-1 rounded text-destructive hover:text-destructive/80 disabled:opacity-60"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// The Work tab's sub-views. Board first — it's the daily-driver surface;
// planning (epics & sprints) and the timeline are their own views so a long
// epic list can't push the board below the fold.
const WORK_VIEWS = ["board", "epics", "timeline"] as const;
type WorkView = (typeof WORK_VIEWS)[number];
const WORK_VIEW_LABELS: Record<WorkView, string> = {
  board: "Board",
  epics: "Epics & sprints",
  timeline: "Timeline",
};

function WorkTab({
  projectId,
  epics,
  editableEpics,
  sprints,
  tasks,
  boardOptions,
  taskCountsByEpic,
  canEdit,
  collabToken,
  userName,
  currentUserId,
}: {
  projectId: string;
  epics: TimelineEpic[];
  editableEpics: EditableEpic[];
  sprints: EditableSprint[];
  tasks: TaskCardModel[];
  boardOptions: TaskBoardOptions;
  taskCountsByEpic: Record<string, { done: number; total: number }>;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
  currentUserId: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  // A `?task=` deep link always lands on the board — that's where the task
  // modal lives.
  const view: WorkView = searchParams.get("task")
    ? "board"
    : WORK_VIEWS.includes(viewParam as WorkView)
      ? (viewParam as WorkView)
      : "board";
  const setView = (next: WorkView) => {
    setSearchParams(
      (prev) => {
        if (next === "board") prev.delete("view");
        else prev.set("view", next);
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Work view"
        className="inline-flex self-start rounded-lg border border-border bg-muted/30 p-0.5"
      >
        {WORK_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              view === v
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {WORK_VIEW_LABELS[v]}
          </button>
        ))}
      </div>

      {view === "board" && (
        <TaskBoard
          projectId={projectId}
          initialTasks={tasks}
          options={boardOptions}
          canManage={canEdit}
          currentUserId={currentUserId}
          currentUserName={userName}
        />
      )}

      {view === "epics" && (
        <EpicSprintManager
          projectId={projectId}
          epics={editableEpics}
          sprints={sprints}
          taskCounts={taskCountsByEpic}
          canManage={canEdit}
          collabToken={collabToken}
          userName={userName}
        />
      )}

      {view === "timeline" && (
        <EpicsTimeline epics={epics} taskCounts={taskCountsByEpic} />
      )}
    </div>
  );
}

