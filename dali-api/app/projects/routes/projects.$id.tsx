import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useSearchParams,
  useSubmit,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { Select, Menu } from "~/components/ui/floating";
import { CalendarDays, CalendarPlus, CalendarX, Check, Globe, Handshake, History, Milestone, Pencil, Pin, X, Settings, Folder, FolderInput, FolderPlus, ChevronRight, ChevronDown, FileText, Info, Users, Paperclip, Plus, Trash2, Upload, Unlink, MoreHorizontal, ExternalLink, Star } from "lucide-react";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { Modal, ModalHeader } from "~/components/Modal";
import { MoveToDialog } from "~/components/sharing/MoveToDialog";
import { useDialog, useConfirmSubmit } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/IconButton";
import { Checkbox } from "~/components/ui/Checkbox";
import { EditableSection } from "~/components/EditableSection";
import { PageIcon } from "~/components/PageIcon";
import { favoritePageIds, recordRouteVisit } from "~/lib/user-pages.server";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { uploadFileToS3, formatBytes } from "~/lib/upload-client";
import type { Route } from "./+types/projects.$id";
import { prisma } from "~/lib/db";
import { ensureProjectGroup } from "~/lib/groups";
import { ensureMeetingNotesFolder } from "~/lib/pages";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { formatDateShort, formatDateTime, fullName, UNKNOWN_LABEL } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { USER_NAME_SELECT } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { Avatar } from "~/components/ui/Avatar";
import { ProjectImageBanner } from "../components/ProjectImageBanner";
import { ProjectViewSwitch } from "../components/ProjectViewSwitch";
import { ProjectIcon } from "~/components/ProjectIcon";
import { ProjectIconPicker } from "../components/ProjectIconPicker";
import { Markdown } from "~/components/Markdown";
import { parseSessionCookie } from "~/lib/cookies";
import { getUserRoles, isCore, isProjectMember, canManageStaffing, currentTerm, isLabMentor } from "~/lib/roles";
import {
  linkProjectPartner,
  unlinkProjectPartner,
  updateProjectPartnerDates,
} from "~/partners/lib/partner-access";
import { getPresenceUser } from "~/lib/presence-user";
import { TaskBoard } from "../components/TaskBoard";
import { ProjectMentorshipTab } from "~/mentorship/components/ProjectMentorshipTab";
import {
  type TimelineEpic,
  type TimelineStory,
  type TimelineTask,
  type TimelineTerm,
  type EpicStatus,
  type StoryDependencyEdge,
} from "../components/EpicsTimeline";
import type { TimelineMilestoneMarker } from "~/lib/milestones";
import { projectTimelineMilestones } from "~/lib/milestones.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import {
  EpicSprintManager,
  type EditableEpic,
  type EditableSprint,
} from "../components/EpicSprintManager";
import {
  resolveTermIdForDate,
  termIdsInRange,
  type TaskBoardOptions,
  type TaskCardModel,
  type TaskStatus,
  type Priority,
} from "../lib/task-board";
import { groupFilesByEpic } from "../lib/file-groups";

export const meta: Route.MetaFunction = ({ data }) => {
  const p = (data as { project?: { name: string } } | undefined)?.project;
  return [{ title: p ? `${p.name} · Projects · DALI OS` : "Project · DALI OS" }];
};

export const handle = {
  breadcrumb: (data: unknown) => {
    const p = (
      data as { project?: { id: string; name: string; iconEmoji: string | null } } | undefined
    )?.project;
    if (!p) return null;
    // Return a one-crumb sub-trail so the project's name carries its icon
    // (emoji, or the neutral fallback glyph) — matching the hub, search, etc.
    return [{ label: p.name, to: `/projects/${p.id}`, icon: <ProjectIcon iconEmoji={p.iconEmoji} /> }];
  },
  headerAction: (data: unknown) => {
    const d = data as { project?: { id: string } } | undefined;
    if (!d?.project) return null;
    return <ProjectViewSwitch projectId={d.project.id} current="internal" />;
  },
  favoriteRoute: true,
};

// Open a project document as a split-screen tab. This page renders inside a
// TabWorkspace iframe, so we ask the parent shell to open /documents/:id in a
// second pane beside the project (dali:openTabToSide → Layout). When somehow
// rendered standalone (no iframe), fall back to a normal same-tab navigation.
// Document panes this page asked the shell to open, so switching subtabs can
// retract them (see closeOpenedDocumentTabs). Module-scoped because the open
// calls happen deep in the Overview tree, and the iframe reloads — dropping
// this set — whenever the page itself goes away.
const openedDocumentUrls = new Set<string>();

function openDocumentTab(pageId: string, label: string) {
  const url = `/documents/${pageId}`;
  if (typeof window !== "undefined" && window.self !== window.top) {
    openedDocumentUrls.add(url);
    window.parent.postMessage(
      { type: "dali:openTabToSide", url, label },
      window.location.origin,
    );
  } else if (typeof window !== "undefined") {
    window.location.assign(url);
  }
}

// Documents are reachable only from Overview, so a doc pane left open while the
// user reads Board or Planning is orphaned UI next to content it has nothing to
// do with. Retract on subtab change; the shell no-ops for any the user already
// closed, and keeps the rest reopenable via mod+shift+T.
function closeOpenedDocumentTabs() {
  if (typeof window === "undefined" || window.self === window.top) return;
  for (const url of openedDocumentUrls) {
    window.parent.postMessage(
      { type: "dali:closeTab", url },
      window.location.origin,
    );
  }
  openedDocumentUrls.clear();
}

const STATUSES = ["Active", "Paused", "Archived"] as const;
type ProjectStatus = (typeof STATUSES)[number];

// "Scope" is no longer a public tab — its domain/term/challenge config moved
// into a settings popup (gated to Core/Admin/Staff). Public tabs are just the
// content views. Board and Planning are separate tabs (Linear-style: different
// data gets real navigation); the only sub-controls are display toggles and
// filters, never a second tab level.
const TABS = ["overview", "board", "mentorship"] as const;
type Tab = (typeof TABS)[number];
function isTab(x: string | null): x is Tab {
  return (TABS as readonly string[]).includes(x ?? "");
}

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  board: "Tasks",
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
  "page.public-visibility",
  "project.showcase-status",
  "project.assignment.level",
  "partner.project.link",
  "partner.project.update",
  "partner.project.unlink",
] as const;

const ACTIVITY_LABELS: Record<string, string> = {
  "projectFile.create": "added a file",
  "projectFile.partner-visibility": "changed a file's partner sharing",
  "page.partner-visibility": "changed a document's partner sharing",
  "page.public-visibility": "changed the public write-up",
  "project.showcase-status": "changed the public showcase status",
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
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
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
      description: true,
      status: true,
      calendarEmail: true,
      teamGroupEmail: true,
      imageUrl: true,
      iconEmoji: true,
      repoUrls: true,
      deploymentUrl: true,
      githubTeamSlug: true,
      slackChannelName: true,
      slackChannelId: true,
      chartStringType: true,
      chartString: true,
      isPrivate: true,
      overviewPageId: true,
      prdPageId: true,
      projectTerms: {
        select: {
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
          targetTermId: true,
          descriptionDocId: true,
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
      sprints: {
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          name: true,
          startsAt: true,
          endsAt: true,
          status: true,
          epicId: true,
          // Edges where this sprint is the dependent (waits on another).
          dependencies: { select: { dependsOnSprintId: true } },
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
          sprintId: true,
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
    prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
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
  // ensureMeetingNotesFolder must complete before pageRows (creates the system
  // folders that pageRows needs to return), so run them first then fan out.
  await Promise.all([
    ensureMeetingNotesFolder(project.id, "Team", auth.user.sub),
    ensureMeetingNotesFolder(project.id, "Partner", auth.user.sub),
  ]);

  const [
    pageRows,
    fileRows,
    favoriteIds,
    taskViews,
    scopeRows,
    bidDomains,
    linkablePartnerOrgs,
    meetingRows,
    presenceUser,
    activityRows,
  ] = await Promise.all([
    // Project documents — non-archived Pages scoped to this project's
    // workspace, top-level and one level of children (folders only ever nest
    // one level deep — see the 2-level cap on Page.parentPageId).
    prisma.page.findMany({
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
        publicVisible: true,
        pinnedAt: true,
        iconEmoji: true,
      },
    }),
    // Project files — standalone uploads with their current version.
    // Tags are edited in the file/document editor, not on this list.
    prisma.projectFile.findMany({
      where: { projectId: project.id, archivedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        partnerVisible: true,
        // Placement in the Drive folder tree — null = tree root, else nested
        // under the Page with this id (must be a Folder-kind Page).
        folderPageId: true,
        currentVersion: { select: { fileName: true, sizeBytes: true } },
        _count: { select: { versions: true } },
        // Which epics this file's linked tasks belong to — used for the deferred
        // epic-grouping feature (kept on the DTO so the data is available later).
        taskLinks: { select: { task: { select: { epicId: true } } } },
      },
    }),
    favoritePageIds(auth.user.sub),
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

  const collabToken = parseSessionCookie(request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
    auth.user.email;
  const userName = presenceUser?.name ?? fallbackName;

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
    publicVisible: d.publicVisible,
    pinned: d.pinnedAt !== null,
    iconEmoji: d.iconEmoji,
    favorited: favoriteIds.has(d.id),
  });
  // Top-level docs for the main list. Pinned ones are lifted into
  // `pinnedDocuments` (rendered above), so they don't appear twice.
  const documents = pageRows
    .filter((p) => p.parentPageId === null && p.pinnedAt === null)
    .map((p) => ({
      ...toDocumentDto(p),
      children: (childrenByParent.get(p.id) ?? []).map(toDocumentDto),
    }));

  // Pinned docs — any page a teammate pinned, most-recent pin first, rendered
  // at the top of the Documents block (and lifted out of the list above).
  const pinnedDocuments = pageRows
    .filter((p) => p.pinnedAt !== null && p.parentPageId === null)
    .sort((a, b) => (b.pinnedAt?.getTime() ?? 0) - (a.pinnedAt?.getTime() ?? 0))
    .map((p) => ({
      ...toDocumentDto(p),
      children: (childrenByParent.get(p.id) ?? []).map(toDocumentDto),
    }));

  const files = fileRows.map((f) => ({
    id: f.id,
    title: f.title,
    folderPageId: f.folderPageId,
    fileName: f.currentVersion?.fileName ?? null,
    sizeBytes: f.currentVersion?.sizeBytes ?? null,
    versionCount: f._count.versions,
    partnerVisible: f.partnerVisible,
    taskLinked: f.taskLinks.length > 0,
    epicIds: [
      ...new Set(
        f.taskLinks
          .map((l) => l.task.epicId)
          .filter((id): id is string => id !== null),
      ),
    ],
  }));

  // ─── Timeline model (epic → story → task) ────────────────────────────────
  // Every level is nested containment: a story bar sits inside its epic bar, a
  // task bar inside its story bar. Only epics resolve to a null span (rendered
  // as unscheduled); stories and tasks always inherit a span from their parent,
  // so a bar never disappears out from under its children.
  //
  // Resolution is deliberately acyclic: epic *base* span (explicit dates, else
  // the union of its sprint dates) → story span (explicit, else the union of
  // its self-dated tasks, else the epic base) → task span (own dates, else the
  // story's) → epic *final* span (base widened to cover its stories).
  const tasksByStoryId = new Map<string, typeof project.tasks>();
  for (const t of project.tasks) {
    if (!t.storyId) continue;
    const bucket = tasksByStoryId.get(t.storyId);
    if (bucket) bucket.push(t);
    else tasksByStoryId.set(t.storyId, [t]);
  }

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

    const stories: TimelineStory[] = [];
    for (const st of e.stories) {
      const storyTasks = tasksByStoryId.get(st.id) ?? [];

      // A task is "self-dated" only when it carries enough to place itself.
      // dueAt alone is a valid one-ended span (start := due), so a task with a
      // deadline and no start still anchors its story.
      const selfDated = storyTasks
        .map((t) => {
          const ts = t.startsAt?.getTime() ?? t.dueAt?.getTime() ?? null;
          const te = t.dueAt?.getTime() ?? t.startsAt?.getTime() ?? null;
          return ts != null && te != null ? { t, ts, te: Math.max(ts, te) } : null;
        })
        .filter((x): x is { t: (typeof storyTasks)[number]; ts: number; te: number } => x !== null);

      let storyStartMs = st.startsAt?.getTime() ?? null;
      let storyEndMs = st.endsAt?.getTime() ?? null;
      if (storyStartMs == null && selfDated.length) {
        storyStartMs = Math.min(...selfDated.map((x) => x.ts));
      }
      if (storyEndMs == null && selfDated.length) {
        storyEndMs = Math.max(...selfDated.map((x) => x.te));
      }
      storyStartMs ??= startMs;
      storyEndMs ??= endMs;
      // Nothing anywhere up the chain has a date — the story can't be placed.
      if (storyStartMs == null || storyEndMs == null) continue;
      if (storyEndMs < storyStartMs) storyEndMs = storyStartMs;

      const sStart = storyStartMs;
      const sEnd = storyEndMs;
      stories.push({
        id: st.id,
        title: st.title,
        status: st.status as TimelineStory["status"],
        startsAt: new Date(sStart).toISOString(),
        endsAt: new Date(sEnd).toISOString(),
        tasks: storyTasks.map((t) => {
          const ts = t.startsAt?.getTime() ?? t.dueAt?.getTime() ?? sStart;
          const te = t.dueAt?.getTime() ?? t.startsAt?.getTime() ?? sEnd;
          return {
            id: t.id,
            title: t.title,
            status: t.status as TimelineTask["status"],
            startsAt: new Date(ts).toISOString(),
            endsAt: new Date(Math.max(ts, te)).toISOString(),
            assignees: t.assignees.map((a) => ({
              id: a.user.id,
              name: fullName(a.user),
            })),
          };
        }),
      });
    }

    // Widen the epic bar to contain every story bar drawn inside it.
    for (const st of stories) {
      const ss = Date.parse(st.startsAt);
      const se = Date.parse(st.endsAt);
      startMs = startMs == null ? ss : Math.min(startMs, ss);
      endMs = endMs == null ? se : Math.max(endMs, se);
    }

    return {
      id: e.id,
      title: e.title,
      status: e.status as EpicStatus,
      startsAt: startMs != null ? new Date(startMs).toISOString() : null,
      endsAt: endMs != null ? new Date(endMs).toISOString() : null,
      sprintCount: epicSprints.length,
      stories,
    };
  });

  const editableEpics: EditableEpic[] = project.epics.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    status: e.status as EditableEpic["status"],
    startsAt: e.startsAt ? e.startsAt.toISOString() : null,
    endsAt: e.endsAt ? e.endsAt.toISOString() : null,
    targetTermId: e.targetTermId,
    descriptionDocId: e.descriptionDocId,
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

  const sprints: EditableSprint[] = project.sprints.map((s) => ({
    id: s.id,
    name: s.name,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    status: s.status as EditableSprint["status"],
    epicId: s.epicId,
    dependsOn: s.dependencies.map((d) => d.dependsOnSprintId),
  }));

  // Flat directed dependency edges (storyId waits on dependsOnStoryId), drawn
  // as arrows between story bars on the timeline. Same shape as the sprint
  // edges above, one tier down.
  const storyDependencies = project.epics.flatMap((e) =>
    e.stories.flatMap((st) =>
      st.dependencies.map((d) => ({
        storyId: st.id,
        dependsOnStoryId: d.dependsOnStoryId,
      })),
    ),
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
    sprintId: t.sprintId,
    storyId: t.storyId,
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
    createdBy: { id: t.createdBy.id, name: fullName(t.createdBy) },
    createdAt: t.createdAt.toISOString(),
    hasUnread: (() => {
      const viewedAt = viewedAtByTaskId.get(t.id);
      return !!viewedAt && t.activityAt > viewedAt;
    })(),
  }));

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
  // Term-ness on the board is derived, not stored: a sprint's term is the one
  // its start date falls in (roll-forward through break weeks, mirroring
  // currentTerm()), and an epic's term footprint is the union of its sprints'
  // terms, the terms its effective span overlaps, and its explicit target
  // term. Term.startDate/endDate stays the single source of truth, so a sprint
  // can never drift out of sync with "its" term. `allTerms` is ascending here,
  // which resolveTermIdForDate/termIdsInRange rely on.
  const sprintTermId = new Map<string, string | null>();
  for (const s of project.sprints) {
    sprintTermId.set(s.id, resolveTermIdForDate(allTerms, s.startsAt));
  }
  // Effective epic span (explicit dates expanded by sprint union) is already
  // computed as ISO strings on `epics`; index it for the range overlap.
  const epicSpanById = new Map(
    epics.map((e) => [e.id, { startsAt: e.startsAt, endsAt: e.endsAt }]),
  );
  const boardEpics = project.epics.map((e) => {
    const ids = new Set<string>();
    for (const s of project.sprints) {
      if (s.epicId !== e.id) continue;
      const tid = sprintTermId.get(s.id);
      if (tid) ids.add(tid);
    }
    const span = epicSpanById.get(e.id);
    const start = span?.startsAt ? new Date(span.startsAt) : null;
    const end = span?.endsAt ? new Date(span.endsAt) : null;
    for (const tid of termIdsInRange(allTerms, start, end)) ids.add(tid);
    if (e.targetTermId) ids.add(e.targetTermId);
    return { id: e.id, title: e.title, termIds: [...ids] };
  });
  // Term filter options: the project's planned terms plus any term a sprint
  // actually resolves to (a sprint may land in a term not in the planned set).
  const boardTermIds = new Set<string>();
  for (const t of plannedTerms) boardTermIds.add(t.id);
  for (const tid of sprintTermId.values()) if (tid) boardTermIds.add(tid);
  const boardTerms = allTerms
    .filter((t) => boardTermIds.has(t.id))
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((t) => ({ id: t.id, code: t.code }));
  const boardCurrentTermId =
    current && boardTermIds.has(current.id) ? current.id : null;

  // Board option lists for the TaskModal: members assignable on this project,
  // and every active domain (reuses the `allDomains` fetch above).
  //
  // Assignments accumulate term after term, so deduping across all of them
  // offered everyone who had ever been staffed here — including people who
  // left the project terms ago. Scope to the current term's team instead, with
  // two deliberate additions:
  //   - a project not staffed this term falls back to its most recent staffed
  //     term, so tasks on a finished project can still be reassigned rather
  //     than facing an empty picker;
  //   - anyone already assigned to one of this project's tasks stays listed.
  //     The picker doubles as the un-assign control (TaskModal renders its
  //     checkbox list from this set), so dropping them would strand the task
  //     with an assignee nobody could remove.
  const currentTermAssignments = current
    ? project.assignments.filter((a) => a.termId === current.id)
    : [];
  const latestStaffedSortKey = project.assignments.reduce<number | null>(
    (max, a) => (max === null || a.term.sortKey > max ? a.term.sortKey : max),
    null,
  );
  const assignableAssignments =
    currentTermAssignments.length > 0
      ? currentTermAssignments
      : latestStaffedSortKey === null
        ? []
        : project.assignments.filter((a) => a.term.sortKey === latestStaffedSortKey);

  const memberMap = new Map<string, string>();
  for (const a of assignableAssignments) {
    const id = a.user.id;
    if (!memberMap.has(id)) {
      memberMap.set(id, fullName(a.user));
    }
  }
  for (const t of tasks) {
    for (const a of t.assignees) {
      if (!memberMap.has(a.id)) memberMap.set(a.id, a.name);
    }
  }
  const sprintFilterOrder = { Active: 0, Planned: 1, Closed: 2 } as const;
  const boardOptions: TaskBoardOptions = {
    members: [...memberMap.entries()]
      .map(([id, name]) => ({ id, name, photoUrl: photoByUserId.get(id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    domains: allDomains.map((d) => ({ id: d.id, name: d.displayName })),
    repoUrls: project.repoUrls,
    sprints: [...sprints]
      .sort(
        (a, b) =>
          sprintFilterOrder[a.status] - sprintFilterOrder[b.status] ||
          a.startsAt.localeCompare(b.startsAt),
      )
      .map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        epicId: s.epicId,
        termId: sprintTermId.get(s.id) ?? null,
      })),
    epics: boardEpics,
    stories: project.epics.flatMap((e) =>
      e.stories.map((st) => ({ id: st.id, title: st.title, epicId: e.id })),
    ),
    projectFiles: files.map((f) => ({ id: f.id, title: f.title })),
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
      contacts: pp.partnerOrg.users.map((u) => ({
        id: u.id,
        name: fullName(u.user),
        displayRole: u.displayRole,
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

  // Milestone markers for the timeline lane (flag-gated; empty otherwise so the
  // timeline is unchanged for anyone without milestones-v2). Core additionally
  // gets a link to change this project's set on the assignment table.
  const milestonesV2Enabled = await isFeatureEnabled(
    "milestones-v2",
    auth.user.sub,
    roles,
    request,
  );
  const timelineMilestones: TimelineMilestoneMarker[] = milestonesV2Enabled
    ? await projectTimelineMilestones(project.id)
    : [];
  const canManageMilestones = core && milestonesV2Enabled;

  return {
    project: {
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
      deploymentUrl: project.deploymentUrl,
      githubTeamSlug: project.githubTeamSlug,
      slackChannelName: project.slackChannelName,
      slackChannelId: project.slackChannelId,
      chartStringType: project.chartStringType,
      chartString: project.chartString,
      isPrivate: project.isPrivate,
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
    allTermOptions: [...allTerms]
      .sort((a, b) => b.sortKey - a.sortKey)
      .map((t) => ({ id: t.id, code: t.code })),
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
    storyDependencies,
    // Term spans anchor the timeline's fixed one-week sprint grid and label
    // its bands (26FA, 26FB, …). Oldest first, the order the grid walks them.
    timelineTerms: [...plannedTerms]
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((t) => ({
        code: t.code,
        startsAt: t.startDate.toISOString(),
        endsAt: t.endDate.toISOString(),
      })),
    timelineMilestones,
    canManageMilestones,
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

// The loader doesn't depend on search params, so a pure search-param change
// (opening/closing the task modal via ?task=, switching the ?epic= filter or
// ?tab=) shouldn't re-run it. Skipping that revalidation avoids a needless
// DB round-trip and the re-render that otherwise bounces the board's scroll
// position to the top when you open a task.
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // Skip revalidation only for a pure search-param *navigation* — opening/
  // closing the task modal (?task=), switching the board filter (?epic=/
  // ?sprint=) or the planning view (?view=). Those don't change loader data,
  // and re-running the loader would bounce the board's scroll to the top.
  //
  // Crucially, this must NOT swallow an explicit revalidator.revalidate()
  // (same URL, search unchanged), which the page relies on to refresh after a
  // mutation — pinning a doc, partner-sharing, file uploads, epic/task edits.
  if (
    !formMethod &&
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search !== nextUrl.search
  ) {
    return false;
  }
  return defaultShouldRevalidate;
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  // Content edits are open to Core/Admin or anyone staffed on the project;
  // scope/domain settings (scopesBulk, domains, terms) stay Core/Admin only.
  const core = await isCore(auth.user.sub, request);
  if (!core && !(await isProjectMember(auth.user.sub, params.id, request))) {
    return { error: "You don't have permission to edit this project." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "details";

  const SCOPE_INTENTS = ["scopesBulk", "domains", "terms", "visibility"];
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

  // Header form: name + status + icon.
  if (intent === "header") {
    const name = (form.get("name") as string | null)?.trim() ?? "";
    const status = (form.get("status") as string | null) ?? "";
    const iconRaw = (form.get("iconEmoji") as string | null)?.trim() ?? "";
    if (!name) return { error: "Project name is required." };
    if (!STATUSES.includes(status as ProjectStatus)) {
      return { error: "Invalid status." };
    }
    await prisma.project.update({
      where: { id: params.id },
      data: { name, status: status as ProjectStatus, iconEmoji: iconRaw || null },
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

  // Private flag. An unchecked checkbox posts nothing, so absence means false.
  if (intent === "visibility") {
    await prisma.project.update({
      where: { id: params.id },
      data: { isPrivate: form.get("isPrivate") === "on" },
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
    storyDependencies,
    timelineTerms,
    timelineMilestones,
    canManageMilestones,
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
  // A task bar on the planning timeline opens the board's task modal, which
  // lives on the Tasks tab — so this hops tabs and sets ?task= in one go.
  const openTaskFromTimeline = (taskId: string) => {
    closeOpenedDocumentTabs();
    setSearchParams(
      (prev) => {
        prev.set("tab", "board");
        prev.set("task", taskId);
        return prev;
      },
      { replace: true },
    );
  };

  const setTab = (next: Tab) => {
    if (next === tab) return;
    closeOpenedDocumentTabs();
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
          planning={
            <PlanningTab
              projectId={project.id}
              epics={epics}
              editableEpics={editableEpics}
              storyDependencies={storyDependencies}
              timelineTerms={timelineTerms}
              timelineMilestones={timelineMilestones}
              canManageMilestones={canManageMilestones}
              terms={plannedTerms}
              taskCountsByEpic={taskCountsByEpic}
              canEdit={canEdit}
              collabToken={collabToken}
              userName={userName}
              onTaskClick={openTaskFromTimeline}
            />
          }
          project={project}
          teams={teams}
          documents={documents}
          pinnedDocuments={pinnedDocuments}
          files={files}
          fileEpics={boardOptions.epics}
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
            subtitle="Visibility, declared domains, planned terms, and the per-domain challenge for each term."
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
          {canEditScope && (
            <SaveAsTemplateSection projectId={project.id} projectName={project.name} />
          )}
          {canEditScope && (
            <DeleteProjectSection projectId={project.id} projectName={project.name} />
          )}
        </Modal>
      )}

      {/* Board keys off the raw edit permission, not the page-level Edit-mode
          toggle: epics/sprints/tasks each gate their own inline edit
          affordances, so there's nothing to "turn on" first. */}
      {tab === "board" && (
        <TaskBoard
          projectId={project.id}
          initialTasks={tasks}
          options={boardOptions}
          canManage={canEdit}
          currentUserId={currentUserId}
          currentUserName={userName}
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
  const [iconEmoji, setIconEmoji] = useState(project.iconEmoji);

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
          <div className="min-w-0">
          <div key={resetKey} className="flex items-center gap-2 flex-wrap">
            {editing && canEdit ? (
              <Form
                method="post"
                ref={formRef}
                className="flex items-center gap-2 flex-wrap"
              >
                <input type="hidden" name="intent" value="header" />
                <input type="hidden" name="iconEmoji" value={iconEmoji ?? ""} />
                <ProjectIconPicker iconEmoji={iconEmoji} editing onChange={setIconEmoji} />
                <input
                  name="name"
                  defaultValue={project.name}
                  aria-label="Project name"
                  autoFocus
                  className="font-heading text-xl font-bold text-foreground px-2 py-1 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
                <Select
                  name="status"
                  defaultValue={project.status}
                  ariaLabel="Project status"
                  options={STATUSES.map((s) => ({ value: s, label: s }))}
                  buttonClassName="text-xs px-2 py-1 border border-border rounded-full bg-background text-muted-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
                />
              </Form>
            ) : (
              <>
                <ProjectIcon iconEmoji={project.iconEmoji} size="lg" />
                <h1 className="font-heading text-2xl font-bold text-foreground">
                  {project.name}
                </h1>
                <StatusBadge status={project.status} />
              </>
            )}

          </div>

          {/* Domains sit on their own row under the title. Sharing the title's
              wrapped flex row meant they trailed off the end of the name and
              broke to an arbitrary place as it grew. */}
          {!editing &&
            (project.domains.length > 0 ? (
              <div className="mt-1.5">
                <DomainChips items={project.domains} />
              </div>
            ) : project.derivedDomains.length > 0 ? (
              <div className="mt-1.5">
                <DomainChips items={project.derivedDomains} muted />
              </div>
            ) : null)}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!editing && (
              <Link
                to={`/calendar?tab=schedule&project=${project.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
              >
                <CalendarPlus className="w-4 h-4" />
                Schedule meeting
              </Link>
            )}
            {canEdit &&
              (editing ? (
                <>
                  <Tooltip label="Cancel">
                    <button
                      type="button"
                      onClick={() => {
                        setIconEmoji(project.iconEmoji);
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
              ))}
          </div>
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
// Private toggle. "Private" only affects form reference questions today: a
// private project is dropped from every `projects:*` source in
// forms/lib/reference-sources.ts, so nobody can pick it as a bid/preference
// answer. It stays fully visible in the hub, search, and to its own team —
// the description below says so, since "private" otherwise reads as broader.
function VisibilitySegment({
  isPrivate,
  canEdit,
}: {
  isPrivate: boolean;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Visibility"
      canEdit={canEdit}
      description="Private projects can't be selected as an answer on forms that pull from the project database."
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          <Form method="post" ref={formRef} key={resetKey}>
            <input type="hidden" name="intent" value="visibility" />
            <Checkbox
              name="isPrivate"
              defaultChecked={isPrivate}
              label="Private project"
              description="Hidden from project dropdowns on forms. Still listed in the project hub and search."
              className="text-sm"
            />
          </Form>
        ) : (
          <p className="text-sm text-foreground">
            {isPrivate ? "Private" : "Standard"}
            <span className="block text-xs text-muted-foreground">
              {isPrivate
                ? "Not offered as a choice on forms that query projects."
                : "Selectable on forms that query projects."}
            </span>
          </p>
        )
      }
    </EditableSection>
  );
}

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
  // terms is already sorted newest-first (plannedTerms), so terms[0] is this
  // project's latest term — the only one expanded by default.
  const [expandedTermIds, setExpandedTermIds] = useState<Set<string>>(
    () => new Set(terms[0] ? [terms[0].id] : []),
  );
  const toggleTerm = (id: string) =>
    setExpandedTermIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
          {terms.map((t) => {
            // Editing needs every term's fields mounted so a save doesn't
            // wipe out cells in a folded term; folding only applies to viewing.
            const open = editing || expandedTermIds.has(t.id);
            return (
              <div key={t.id} className="flex flex-col gap-2">
                {editing ? (
                  <h3 className="text-sm font-semibold text-foreground">{t.code}</h3>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleTerm(t.id)}
                    className="flex items-center gap-1.5 text-left text-sm font-semibold text-foreground"
                  >
                    {open ? (
                      <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                    )}
                    {t.code}
                  </button>
                )}
                <div className={`flex flex-col gap-3 ${open ? "" : "hidden"}`}>
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
            );
          })}
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
      <Select
        ariaLabel={`Level for ${member.name} in ${member.domain}`}
        value={value}
        disabled={busy}
        onChange={(next) => {
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
        options={LEVEL_OPTIONS.map((opt) => {
          const reason = disabledReason(opt);
          return {
            value: opt,
            label: `${opt}${reason ? " (locked)" : ""}`,
            description: reason ?? undefined,
            disabled: reason !== null,
          };
        })}
        buttonClassName="text-xs bg-transparent text-muted-foreground rounded border border-transparent hover:border-border focus:border-border focus:outline-none px-0.5 inline-flex items-center justify-between gap-1 transition-colors"
      />
      {error && (
        <span className="text-[10px] leading-tight text-destructive" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function OverviewTab({
  planning,
  project,
  teams,
  documents,
  pinnedDocuments,
  files,
  fileEpics,
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
  // The epics & sprints timeline, rendered at the top of the body. Passed in
  // as an element so Overview doesn't have to re-declare all of Planning's
  // props just to forward them.
  planning: ReactNode;
  project: LoaderData["project"];
  teams: LoaderData["teams"];
  documents: LoaderData["documents"];
  pinnedDocuments: LoaderData["pinnedDocuments"];
  files: LoaderData["files"];
  fileEpics: LoaderData["boardOptions"]["epics"];
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
  const tz = useUserTimeZone();

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
      {/* Epics & sprints timeline, on top — the planning view is the first
          thing the project page shows. */}
      {planning}

      {/* Description — separate from Project details */}
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
                  {formatDateTime(m.startsAt, tz)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Drive — the project's one file surface: collab-doc pages and uploaded
          files together in one folder tree. Files render inline (root-level
          at the bottom, folder-placed nested under the matching folder). */}
      <DocumentsBlock
        projectId={project.id}
        documents={documents}
        pinnedDocuments={pinnedDocuments}
        files={files}
        fileEpics={fileEpics}
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

// Admin/Core only. Deletion is permanent and the server refuses it once a
// project has any history, so the affordance stays tucked inside settings and
// asks for the project name typed back before it fires.
// Save the project's structure (epics, sprints, tasks, checklists) as a
// reusable template. Posts to the /projects action (intent=capture). Gated by
// the `templates` flag. Sibling of the Danger zone in the settings modal.
function SaveAsTemplateSection({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const templatesEnabled = useFeatureFlag("templates");
  if (!templatesEnabled) return null;
  return (
    <section className="mt-6 border-t border-border pt-5">
      <h3 className="text-sm font-semibold text-foreground">Save as template</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Capture this project's epics, sprints, and tasks (with checklists) as a reusable
        template. Sprint dates are stored as offsets and rebased when a new project is created
        from it. Collaborative doc bodies are not copied.
      </p>
      <Form method="post" action="/projects" className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="intent" value="capture" />
        <input type="hidden" name="projectId" value={projectId} />
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Template name</span>
          <input
            name="templateName"
            required
            defaultValue={`${projectName} template`}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground pb-2">
          <input type="checkbox" name="includeOverviewPage" className="accent-accent-coral" />
          Include Overview page
        </label>
        <button type="submit" className="rounded-md bg-accent-coral px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-coral/90 transition-colors">
          Save template
        </button>
      </Form>
    </section>
  );
}

function DeleteProjectSection({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const dialog = useDialog();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ label: string; count: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setBlocked(null);
    setError(null);

    const typed = await dialog.prompt({
      title: `Delete "${projectName}"?`,
      description:
        "This permanently removes the project. It can't be undone. Archiving keeps the project and its history instead.",
      label: `Type the project name to confirm`,
      placeholder: projectName,
      confirmLabel: "Delete project",
      validate: (value) =>
        value.trim() === projectName ? null : "That doesn't match the project name.",
    });
    if (typed === null) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (res.ok) {
        navigate("/projects");
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { error?: string; blocking?: { label: string; count: number }[] }
        | null;
      if (res.status === 409 && body?.blocking?.length) {
        setBlocked(body.blocking);
        return;
      }
      setError(body?.error ?? "Could not delete this project.");
    } catch {
      setError("Could not delete this project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 border-t border-border pt-5">
      <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Deleting is permanent and only possible while a project has no staffing, tasks,
        meetings, time entries or budget records. Archive it instead to retire a project
        that has history.
      </p>

      {blocked && (
        <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">
            Still attached to this project:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {blocked.map((b) => (
              <li key={b.label} className="text-xs text-muted-foreground">
                {b.count} {b.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        {busy ? "Deleting…" : "Delete project"}
      </button>
    </section>
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

      <VisibilitySegment isPrivate={project.isPrivate} canEdit={canEdit} />

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
  const confirmSubmit = useConfirmSubmit();
  const [linking, setLinking] = useState(false);
  const tz = useUserTimeZone();

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
          <Select
            name="partnerOrgId"
            required
            placeholder="Select an organization…"
            options={[
              { value: "", label: "Select an organization…" },
              ...linkablePartnerOrgs.map((o) => ({ value: o.id, label: o.name })),
            ]}
            buttonClassName="h-9 flex-1 min-w-[220px] rounded-lg border border-border bg-background px-3 text-sm inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
          <button
            type="submit"
            className="h-9 rounded-lg bg-dark-blue text-white text-sm font-medium px-4 hover:opacity-90 transition"
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
                      Ended {formatDateShort(p.endedAt, tz)}
                    </span>
                  ) : p.active && p.startedAt ? (
                    <span className="text-xs text-muted-foreground">
                      since {formatDateShort(p.startedAt, tz)}
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
                  onSubmit={confirmSubmit({
                    title: `End the partnership with ${p.org.name}?`,
                    description:
                      "The record and its dates are kept — this only marks the partnership as ended today.",
                    confirmLabel: "End partnership",
                    tone: "destructive",
                  })}
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
                  onSubmit={confirmSubmit({
                    title: `Unlink ${p.org.name}?`,
                    description:
                      'This erases the partnership record entirely — use "End partnership" instead to keep the history.',
                    confirmLabel: "Unlink",
                    tone: "destructive",
                  })}
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

// Row-level doc type (folder children and top-level docs are structurally
// compatible for the row UI).
type DocRowItem = LoaderData["documents"][number]["children"][number];

// Callbacks + drag state a document row needs. Bundled so the row components
// can live at module scope: defining them inside DocumentsBlock gave them a new
// identity on every render, which remounted the whole list and detached any
// open "⋯" floating menu mid-interaction (Playwright saw "element detached").
type DocRowCtx = {
  canEdit: boolean;
  drag: { id: string; isFolder: boolean } | null;
  dropTarget: string | "root" | null;
  setDrag: (d: { id: string; isFolder: boolean } | null) => void;
  setDropTarget: React.Dispatch<React.SetStateAction<string | "root" | null>>;
  onDropBefore: (targetId: string, parentId: string | null) => void;
  toggleFavorite: (id: string, next: boolean) => void;
  togglePartnerVisible: (id: string, next: boolean) => void;
  togglePin: (id: string, next: boolean) => void;
  setMoveDoc: (d: { id: string; title: string } | null) => void;
  deleteDocument: (id: string, title: string) => void;
};

// Row "⋯" menu (Drive redesign) — every per-row action (favorite, partner
// share, pin, move, delete) lives here instead of as loose inline icons.
function DocRowMenu({ doc, indent, ctx }: { doc: DocRowItem; indent: boolean; ctx: DocRowCtx }) {
  return (
    <Menu
      align="right"
      ariaLabel="Document actions"
      trigger={
        <button
          type="button"
          aria-label="Document actions"
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      }
    >
      {doc.kind !== "Folder" && (
        <Menu.Item
          icon={<Star className={`w-3.5 h-3.5 ${doc.favorited ? "fill-current text-accent-coral" : ""}`} />}
          onSelect={() => ctx.toggleFavorite(doc.id, !doc.favorited)}
        >
          {doc.favorited ? "Remove from favorites" : "Add to favorites"}
        </Menu.Item>
      )}
      {ctx.canEdit && (
        <Menu.Item
          icon={<Handshake className="w-3.5 h-3.5" />}
          onSelect={() => ctx.togglePartnerVisible(doc.id, !doc.partnerVisible)}
        >
          {doc.partnerVisible ? "Stop sharing with partner" : "Share with partner"}
        </Menu.Item>
      )}
      {ctx.canEdit && !indent && (
        <Menu.Item
          icon={<Pin className={`w-3.5 h-3.5 ${doc.pinned ? "fill-current" : ""}`} />}
          onSelect={() => ctx.togglePin(doc.id, !doc.pinned)}
        >
          {doc.pinned ? "Unpin" : "Pin to top"}
        </Menu.Item>
      )}
      {ctx.canEdit && !doc.isSystem && (
        <Menu.Item
          icon={<FolderInput className="w-3.5 h-3.5" />}
          onSelect={() => ctx.setMoveDoc({ id: doc.id, title: doc.title })}
        >
          Move to…
        </Menu.Item>
      )}
      {ctx.canEdit && (
        <>
          <Menu.Separator />
          <Menu.Item icon={<Trash2 className="w-3.5 h-3.5" />} onSelect={() => ctx.deleteDocument(doc.id, doc.title)}>
            Delete
          </Menu.Item>
        </>
      )}
    </Menu>
  );
}

function DocRowInner({ doc, indent, ctx }: { doc: DocRowItem; indent: boolean; ctx: DocRowCtx }) {
  return (
    <div className={`group py-2.5 flex items-center justify-between gap-3 text-sm ${indent ? "pl-6" : ""}`}>
      <button
        type="button"
        onClick={() => openDocumentTab(doc.id, doc.title)}
        className="flex items-center gap-2 min-w-0 text-left font-medium text-foreground hover:text-accent-coral"
      >
        <PageIcon iconEmoji={doc.iconEmoji} />
        <span className="truncate">{doc.title}</span>
      </button>
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Read-only status badges stay inline; all actions live in "⋯". */}
        {doc.partnerVisible && (
          <Tooltip label="Shared with partner">
            <span className="flex items-center text-accent-teal">
              <Handshake className="w-3.5 h-3.5" />
            </span>
          </Tooltip>
        )}
        {doc.publicVisible && (
          <Tooltip label="Public write-up — rendered on this project's page on dali.website">
            <span className="flex items-center text-accent-coral">
              <Globe className="w-3.5 h-3.5" />
            </span>
          </Tooltip>
        )}
        <DocRowMenu doc={doc} indent={indent} ctx={ctx} />
      </div>
    </div>
  );
}

function DocRow({
  doc,
  indent,
  parentId,
  ctx,
}: {
  doc: DocRowItem;
  indent: boolean;
  parentId: string | null;
  ctx: DocRowCtx;
}) {
  const dragProps = ctx.canEdit
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          ctx.setDrag({ id: doc.id, isFolder: false });
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", doc.id);
        },
        onDragEnd: () => ctx.setDrag(null),
        onDragOver: (e: React.DragEvent) => {
          if (!ctx.drag) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (ctx.dropTarget !== doc.id) ctx.setDropTarget(doc.id);
        },
        onDragLeave: () => ctx.setDropTarget((t) => (t === doc.id ? null : t)),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          ctx.onDropBefore(doc.id, parentId);
        },
      }
    : {};
  return (
    <div {...dragProps} className={ctx.drag && ctx.dropTarget === doc.id ? "border-t-2 border-accent-coral" : ""}>
      <DocRowInner doc={doc} indent={indent} ctx={ctx} />
    </div>
  );
}

function DocumentsBlock({
  projectId,
  documents,
  pinnedDocuments,
  files,
  fileEpics,
  canEdit,
  hasActivePartner,
}: {
  projectId: string;
  documents: LoaderData["documents"];
  pinnedDocuments: LoaderData["pinnedDocuments"];
  files: LoaderData["files"];
  fileEpics: LoaderData["boardOptions"]["epics"];
  canEdit: boolean;
  hasActivePartner: boolean;
}) {
  const dialog = useDialog();
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // When set, next pick uploads a new version of this file id; null = new file.
  const versionForId = useRef<string | null>(null);
  // The folder context for the next upload — set when user clicks Upload inside
  // a specific folder, so the new file lands inside that folder (via folderPageId).
  const uploadFolderIdRef = useRef<string | null>(null);
  // "Move to…" dialog state — tracks which doc the user wants to move.
  const [moveDoc, setMoveDoc] = useState<{ id: string; title: string } | null>(null);
  // Folders start collapsed (Finder/Drive convention). Newly created folders are
  // added to this set so their contents show right after creation.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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

  // Share/unshare a page with the project's partner org(s). The public
  // write-up is not toggled from here — the Public view owns nominating it
  // (ensurePublicWriteupPage), so there's no second control for it in the
  // Documents list. Persisted via its own API route; the badge state comes
  // back through the loader.
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

  // Pin/unpin a doc to the top of the Documents block. Same persist-then-
  // revalidate shape as sharing.
  async function togglePin(id: string, next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${id}/pin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: next }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to update pin");
      }
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // Toggle the viewer's personal favorite for a page (same endpoint as
  // FavoriteStar). Used by the row "⋯" menu under the Drive redesign, where the
  // star lives in the menu rather than inline.
  async function toggleFavorite(id: string, next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${id}/favorite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorited: next }),
      });
      if (!res.ok) throw new Error("Failed to update favorite");
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
    const title = await dialog.prompt({ title: "New folder", label: "Folder name" });
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
    if (
      !(await dialog.confirm({
        title: `Delete document "${title}"?`,
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    )
      return;
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

  // Drag-and-drop: reorder documents and move them into/out of folders.
  // `drag` tracks the item being dragged; `dropTarget` highlights the current
  // drop zone (a page id, or "root" for the top-level list).
  const [drag, setDrag] = useState<{ id: string; isFolder: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);
  async function moveDocument(id: string, parentPageId: string | null, beforeId: string | null) {
    setDrag(null);
    setDropTarget(null);
    if (id === beforeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${id}/move`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPageId, beforeId }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to move document");
      }
      if (parentPageId) setExpanded((prev) => new Set(prev).add(parentPageId));
      revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  // Drop onto a document row → reorder before it, into that row's parent.
  function onDropBefore(targetId: string, targetParentId: string | null) {
    if (drag) void moveDocument(drag.id, targetParentId, targetId);
  }
  // Drop onto a folder header → a doc moves into the folder; a folder reorders
  // before that folder at the top level (folders never nest).
  function onDropOnFolder(folderId: string) {
    if (!drag) return;
    if (drag.isFolder) void moveDocument(drag.id, null, folderId);
    else void moveDocument(drag.id, folderId, null);
  }

  // ── File upload (new file or new version) ────────────────────────────────
  // The hidden <input> is shared for both flows; refs decide what to do on pick.
  async function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const targetId = versionForId.current;
    const folderId = uploadFolderIdRef.current;
    versionForId.current = null;
    uploadFolderIdRef.current = null;

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
          body: JSON.stringify({
            title: picked.name,
            ...(folderId ? { folderPageId: folderId } : {}),
            ...meta,
          }),
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

  function triggerUpload(folderId?: string) {
    versionForId.current = null;
    uploadFolderIdRef.current = folderId ?? null;
    fileInputRef.current?.click();
  }

  function triggerVersionUpload(fileId: string) {
    versionForId.current = fileId;
    uploadFolderIdRef.current = null;
    fileInputRef.current?.click();
  }

  async function deleteFile(id: string, title: string) {
    if (
      !(await dialog.confirm({
        title: `Delete file "${title}"?`,
        description: "All versions will be removed.",
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    )
      return;
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

  async function toggleFilePartnerVisible(id: string, next: boolean) {
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

  // "Folders" = the default folder tree; "epics" = files grouped by epic.
  const [fileView, setFileView] = useState<"folders" | "epics">("folders");

  // Derived: files split by folder placement so the tree can render them inline.
  const rootFiles = files.filter((f) => f.folderPageId === null);
  const filesByFolder = new Map<string, LoaderData["files"]>();
  for (const f of files) {
    if (!f.folderPageId) continue;
    const bucket = filesByFolder.get(f.folderPageId);
    if (bucket) bucket.push(f);
    else filesByFolder.set(f.folderPageId, [f]);
  }

  // Epic-grouped view — only computed when the toggle is active or there are
  // files to group (avoids the import being dead weight on every render).
  const epicGroups = groupFilesByEpic(files, fileEpics);

  function renderFileRow(f: LoaderData["files"][number], indent: boolean) {
    return (
      <div key={f.id} className={`group py-2.5 flex items-center justify-between gap-3 text-sm ${indent ? "pl-6" : ""}`}>
        <Link
          to={`/documents/file/${f.id}`}
          className="flex items-center gap-2 min-w-0 text-left font-medium text-foreground hover:text-accent-coral"
        >
          <Paperclip className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
          <span className="truncate">{f.title}</span>
          <span className="text-muted-foreground text-xs font-normal flex-shrink-0">
            {f.fileName}
            {f.sizeBytes != null ? ` · ${formatBytes(f.sizeBytes)}` : ""}
            {f.versionCount > 1 ? ` · v${f.versionCount}` : ""}
          </span>
        </Link>
        <div className="flex items-center gap-2 flex-shrink-0">
          {f.partnerVisible && !canEdit && (
            <Tooltip label="Shared with partner">
              <span className="flex items-center text-accent-teal">
                <Handshake className="w-3.5 h-3.5" />
              </span>
            </Tooltip>
          )}
          {canEdit && (
            <Menu
              align="right"
              ariaLabel="File actions"
              trigger={
                <button
                  type="button"
                  aria-label="File actions"
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              }
            >
              <Menu.Item
                icon={<Handshake className="w-3.5 h-3.5" />}
                onSelect={() => void toggleFilePartnerVisible(f.id, !f.partnerVisible)}
              >
                {f.partnerVisible ? "Stop sharing with partner" : "Share with partner"}
              </Menu.Item>
              <Menu.Item
                icon={<Upload className="w-3.5 h-3.5" />}
                onSelect={() => triggerVersionUpload(f.id)}
              >
                Upload new version
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onSelect={() => void deleteFile(f.id, f.title)}
              >
                Delete
              </Menu.Item>
            </Menu>
          )}
        </div>
      </div>
    );
  }

  // Row callbacks + drag state, bundled for the module-scope row components.
  // Kept as one object (not spread props) so hoisting the rows didn't balloon
  // into a dozen individual props at every call site.
  const rowCtx: DocRowCtx = {
    canEdit,
    drag,
    dropTarget,
    setDrag,
    setDropTarget,
    onDropBefore,
    toggleFavorite,
    togglePartnerVisible,
    togglePin,
    setMoveDoc,
    deleteDocument,
  };

  const isEmpty = documents.length === 0 && files.length === 0;

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      {/* Hidden file input shared for new-file and new-version uploads. */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePick} />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Folder className="w-4 h-4" /> Drive
        </h2>
        {/* This block is an embed of the project's Drive folder. An
            Open-in-Drive link jumps to it in the main Drive; create actions
            consolidate into one New ▾ menu. */}
        <div className="flex items-center gap-2">
          {/* View toggle — only shown when there are uploaded files to group. */}
          {files.length > 0 && (
            <div className="flex items-center rounded-md border border-border text-xs font-medium overflow-hidden">
              <button
                type="button"
                onClick={() => setFileView("folders")}
                className={`px-2 py-1 transition-colors ${
                  fileView === "folders"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                Folders
              </button>
              <button
                type="button"
                onClick={() => setFileView("epics")}
                className={`px-2 py-1 transition-colors border-l border-border ${
                  fileView === "epics"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                By epic
              </button>
            </div>
          )}
          <Link
            to={`/drive?scope=${projectId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-accent-coral transition-colors"
          >
            Open in Drive <ExternalLink className="w-3.5 h-3.5" />
          </Link>
          {canEdit && (
            <Menu
              align="right"
              ariaLabel="New in project Drive"
              trigger={
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> New
                  <ChevronDown className="w-3 h-3 opacity-70" />
                </button>
              }
            >
              <Menu.Item icon={<FileText className="w-3.5 h-3.5" />} onSelect={() => void createDocument()}>
                New document
              </Menu.Item>
              <Menu.Item icon={<FolderPlus className="w-3.5 h-3.5" />} onSelect={() => void createFolder()}>
                New folder
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item icon={<Upload className="w-3.5 h-3.5" />} onSelect={() => triggerUpload()}>
                Upload file
              </Menu.Item>
            </Menu>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {isEmpty ? (
        <p className="text-sm text-muted-foreground italic">No documents yet.</p>
      ) : fileView === "epics" ? (
        /* ── By-epic view: files only, clustered under their linked epic. ── */
        <div className="flex flex-col gap-4">
          {epicGroups.epicGroups.map((g) => (
            <div key={g.id}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                {g.title}
                <span className="ml-1.5 normal-case tracking-normal">({g.files.length})</span>
              </h3>
              <div className="flex flex-col divide-y divide-border">
                {g.files.map((f) => renderFileRow(f, false))}
              </div>
            </div>
          ))}
          {epicGroups.otherWorkFiles.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Other work files
                <span className="ml-1.5 normal-case tracking-normal">({epicGroups.otherWorkFiles.length})</span>
              </h3>
              <div className="flex flex-col divide-y divide-border">
                {epicGroups.otherWorkFiles.map((f) => renderFileRow(f, false))}
              </div>
            </div>
          )}
          {epicGroups.generalFiles.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Other files
                <span className="ml-1.5 normal-case tracking-normal">({epicGroups.generalFiles.length})</span>
              </h3>
              <div className="flex flex-col divide-y divide-border">
                {epicGroups.generalFiles.map((f) => renderFileRow(f, false))}
              </div>
            </div>
          )}
          {files.length > 0 &&
            epicGroups.epicGroups.length === 0 &&
            epicGroups.otherWorkFiles.length === 0 &&
            epicGroups.generalFiles.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No files to group.</p>
            )}
        </div>
      ) : (
        <div
          onDragOver={
            canEdit && drag
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropTarget !== "root") setDropTarget("root");
                }
              : undefined
          }
          onDragLeave={
            canEdit ? () => setDropTarget((t) => (t === "root" ? null : t)) : undefined
          }
          onDrop={
            canEdit && drag
              ? (e) => {
                  e.preventDefault();
                  void moveDocument(drag.id, null, null);
                }
              : undefined
          }
          className={`flex flex-col divide-y divide-border rounded-md ${
            dropTarget === "root" ? "ring-2 ring-accent-coral/40" : ""
          }`}
        >
          {/* Pinned docs on top — full document rows (share/pin/delete), just
              lifted above the rest. The filled coral pin marks them pinned. */}
          {pinnedDocuments.map((d) => (
            <DocRow key={d.id} doc={d} indent={false} parentId={null} ctx={rowCtx} />
          ))}
          {documents.map((doc) =>
            doc.kind === "Folder" ? (
              <div
                key={doc.id}
                draggable={canEdit}
                onDragStart={
                  canEdit
                    ? (e) => {
                        setDrag({ id: doc.id, isFolder: true });
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", doc.id);
                      }
                    : undefined
                }
                onDragEnd={canEdit ? () => setDrag(null) : undefined}
                className={`py-2.5 flex flex-col gap-1 ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                <div
                  onDragOver={
                    canEdit && drag
                      ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dropTarget !== doc.id) setDropTarget(doc.id);
                        }
                      : undefined
                  }
                  onDragLeave={
                    canEdit ? () => setDropTarget((t) => (t === doc.id ? null : t)) : undefined
                  }
                  onDrop={
                    canEdit && drag
                      ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onDropOnFolder(doc.id);
                        }
                      : undefined
                  }
                  className={`flex items-center justify-between gap-3 text-sm rounded-md ${
                    dropTarget === doc.id ? "ring-2 ring-accent-coral/60 bg-accent-coral/5" : ""
                  }`}
                >
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
                      <Tooltip label="Upload file into folder">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => triggerUpload(doc.id)}
                          aria-label="Upload file into folder"
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-60"
                        >
                          <Upload className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                      {!doc.isSystem && (
                        <button
                          type="button"
                          disabled={busy || doc.children.length > 0 || (filesByFolder.get(doc.id)?.length ?? 0) > 0}
                          title={
                            doc.children.length > 0 || (filesByFolder.get(doc.id)?.length ?? 0) > 0
                              ? "Move or delete the items inside this folder first"
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
                {expanded.has(doc.id) && (() => {
                  const folderFiles = filesByFolder.get(doc.id) ?? [];
                  const hasContent = doc.children.length > 0 || folderFiles.length > 0;
                  return hasContent ? (
                    <div className="flex flex-col divide-y divide-border">
                      {doc.children.map((child) => (
                        <DocRow key={child.id} doc={child} indent parentId={doc.id} ctx={rowCtx} />
                      ))}
                      {folderFiles.map((f) => renderFileRow(f, true))}
                    </div>
                  ) : (
                    <p className="pl-6 text-xs text-muted-foreground italic">Empty</p>
                  );
                })()}
              </div>
            ) : (
              <DocRow key={doc.id} doc={doc} indent={false} parentId={null} ctx={rowCtx} />
            ),
          )}
          {/* Root-level uploaded files (no folder) appear after all docs. */}
          {rootFiles.map((f) => renderFileRow(f, false))}
        </div>
      )}

      <MoveToDialog
        open={!!moveDoc}
        pageId={moveDoc?.id ?? ""}
        title={moveDoc?.title ?? ""}
        current={{ type: "Project", id: projectId }}
        onClose={() => setMoveDoc(null)}
        onMoved={() => {
          setMoveDoc(null);
          revalidator.revalidate();
        }}
      />
    </section>
  );
}

// Planning holds the epics & sprints manager, rendered as the Gantt timeline
// at the top of Overview.
function PlanningTab({
  projectId,
  epics,
  editableEpics,
  storyDependencies,
  timelineTerms,
  timelineMilestones,
  canManageMilestones,
  terms,
  taskCountsByEpic,
  canEdit,
  collabToken,
  userName,
  onTaskClick,
}: {
  projectId: string;
  epics: TimelineEpic[];
  editableEpics: EditableEpic[];
  storyDependencies: StoryDependencyEdge[];
  timelineTerms: TimelineTerm[];
  timelineMilestones: TimelineMilestoneMarker[];
  canManageMilestones: boolean;
  terms: { id: string; code: string }[];
  taskCountsByEpic: Record<string, { done: number; total: number }>;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
  onTaskClick: (taskId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {canManageMilestones && (
        <div className="flex items-center justify-end">
          <Link
            to="/core/milestones/assign"
            prefetch="intent"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Milestone className="h-3.5 w-3.5" />
            Milestones: assign in Core
          </Link>
        </div>
      )}
      <EpicSprintManager
        projectId={projectId}
        epics={editableEpics}
        terms={terms}
        taskCounts={taskCountsByEpic}
        canManage={canEdit}
        collabToken={collabToken}
        userName={userName}
        timelineEpics={epics}
        storyDependencies={storyDependencies}
        timelineTerms={timelineTerms}
        timelineMilestones={timelineMilestones}
        onTaskClick={onTaskClick}
      />
    </div>
  );
}

// Same look as ViewToggle's buttons (the hub's list/cards switch) — that
// component is hardwired to list/card values, so the planning toggle borrows
// its styling rather than its state.

