import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useSearchParams,
  useSubmit,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { Select, Menu, Popover } from "~/components/ui/floating";
import { CalendarDays, CalendarPlus, CalendarX, Check, Globe, Handshake, History, Pencil, Pin, X, Settings, Folder, FolderInput, FolderPlus, ChevronRight, ChevronDown, FileText, Info, Users, Paperclip, Plus, Trash2, Upload, Unlink, MoreHorizontal, ExternalLink, Star, Mail, Github, Slack, Layers } from "lucide-react";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { Modal, ModalHeader } from "~/components/Modal";
import { MoveToDialog } from "~/components/sharing/MoveToDialog";
import { useDialog, useConfirmSubmit } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import { EditableSection } from "~/components/EditableSection";
import { PageIcon } from "~/components/PageIcon";
import { favoritePageIds, recordRouteVisit } from "~/lib/user-pages.server";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { uploadFileToS3, formatBytes } from "~/lib/upload-client";
import type { Route } from "./+types/projects.$id";
import { buildProjectCalendar } from "~/projects/lib/project-calendar.server";
import { MonthCalendarPanel } from "~/components/MonthCalendarPanel";
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
  type TimelineTerm,
  type StoryDependencyEdge,
} from "../components/EpicsTimeline";
import { buildTimelineEpics } from "../lib/timeline-epics";
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
import { loadProjectDriveScope } from "~/lib/drive-scopes.server";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import type { RowActions } from "~/components/drive/DriveBrowser";

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

// The dali.os cut of the same page. Nothing new is computed for it — the
// content is the classic tabs redealt: the planning timeline and the task
// board are one "Progress" surface, the project's files get their own "Drive"
// tab, and what's left of Overview is the project's details. Meetings are no
// longer a tab — they ride the Progress timeline as day-pinned chips.
const OS_TABS = ["progress", "drive", "details", "mentorship"] as const;
type OsTab = (typeof OS_TABS)[number];
function isOsTab(x: string | null): x is OsTab {
  return (OS_TABS as readonly string[]).includes(x ?? "");
}

const OS_TAB_LABELS: Record<OsTab, string> = {
  progress: "Progress",
  drive: "Drive",
  details: "Project details",
  mentorship: "Mentorship",
};

// Links already in the wild carry ?tab=overview / ?tab=board, and openTaskFrom
// Timeline still writes "board". Translate rather than 404 into the default:
// the board folded into Progress, Overview became Project details.
const CLASSIC_TO_OS: Record<Tab, OsTab> = {
  overview: "details",
  board: "progress",
  mentorship: "mentorship",
};
// And back, for a member who lands on an os link with the flag off. Drive has
// no classic equivalent — its files live in Overview there.
const OS_TO_CLASSIC: Record<OsTab, Tab> = {
  progress: "board",
  drive: "overview",
  details: "overview",
  mentorship: "mentorship",
};

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
          _count: { select: { comments: true } },
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
  // so a bar never disappears out from under its children. The span resolution
  // itself lives in ../lib/timeline-epics — the partner hub draws the same bars.
  const epics: TimelineEpic[] = buildTimelineEpics({
    epics: project.epics,
    sprints: project.sprints,
    tasks: project.tasks.map((t) => ({
      id: t.id,
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
    commentCount: t._count.comments,
    createdBy: { id: t.createdBy.id, name: fullName(t.createdBy) },
    createdAt: t.createdAt.toISOString(),
    activityAt: t.activityAt.toISOString(),
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
  // Term spans anchor the fixed one-week sprint grid and label its bands
  // (26FA, 26FB, …). Oldest first, the order the grid walks them. Both the
  // timeline and the task modal read weeks off this same anchor, so it's built
  // once here rather than twice.
  const termSpans = [...plannedTerms]
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((t) => ({
      code: t.code,
      startsAt: t.startDate.toISOString(),
      endsAt: t.endDate.toISOString(),
    }));
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
  const [projectCalendar, projectDriveScope] = await Promise.all([
    tabParam === "meetings"
      ? buildProjectCalendar({
          request,
          viewerId: auth.user.sub,
          projectId: project.id,
          calendarEmail: project.calendarEmail,
          epics,
        })
      : Promise.resolve(null),
    // Drive tab scope — loaded always so tab-switching is instant. The two
    // underlying Prisma queries (pages + files) are comparable in cost to the
    // Stage 2 pageRows/fileRows already fetched above.
    loadProjectDriveScope({
      userSub: auth.user.sub,
      projectId: project.id,
      projectName: project.name,
      projectIconEmoji: project.iconEmoji,
      request,
    }),
  ]);

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
    projectCalendar,
    recentActivity,
    epics,
    editableEpics,
    sprints,
    storyDependencies,
    timelineTerms: termSpans,
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
    projectDriveScope,
  };
}

// Search params the loader actually reads. `tab` gates the Meetings month grid
// and `month` pages it — a navigation that changes either has to re-run the
// loader or the tab renders with data built for the previous URL. Everything
// else on this page (?task=, ?epic=, ?sprint=, ?view=) is client-only.
const LOADER_SEARCH_PARAMS = ["tab", "month"] as const;

// The loader depends on only the params above, so any other search-param change
// (opening/closing the task modal via ?task=, switching the ?epic= filter)
// shouldn't re-run it. Skipping that revalidation avoids a needless DB
// round-trip and the re-render that otherwise bounces the board's scroll
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
    currentUrl.search !== nextUrl.search &&
    LOADER_SEARCH_PARAMS.every(
      (key) => currentUrl.searchParams.get(key) === nextUrl.searchParams.get(key),
    )
  ) {
    return false;
  }
  return defaultShouldRevalidate;
}

// Declared domains for this project. Full-replacement: the incoming set wins.
// Filtered down to active, real Domain ids so a stale dropdown value can't
// create orphan rows. Wrapped in a transaction so a partial failure leaves the
// project's domain list untouched.
async function replaceProjectDomains(projectId: string, incoming: string[]) {
  const valid = incoming.length
    ? await prisma.domain.findMany({
        where: { id: { in: incoming }, active: true },
        select: { id: true },
      })
    : [];
  const ids = valid.map((d) => d.id);
  await prisma.$transaction([
    prisma.projectDomain.deleteMany({ where: { projectId } }),
    ...(ids.length
      ? [
          prisma.projectDomain.createMany({
            data: ids.map((domainId) => ({ projectId, domainId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

// Project term set. Full-replacement too, so the one helper covers both adding
// and removing terms. The start term and active-this-term are derived from this
// set, not stored.
async function replaceProjectTerms(projectId: string, incoming: string[]) {
  const valid = incoming.length
    ? await prisma.term.findMany({
        where: { id: { in: incoming } },
        select: { id: true },
      })
    : [];
  const ids = valid.map((t) => t.id);
  await prisma.$transaction([
    prisma.projectTerm.deleteMany({ where: { projectId } }),
    ...(ids.length
      ? [
          prisma.projectTerm.createMany({
            data: ids.map((termId) => ({ projectId, termId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
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

  // Header form: name + status + icon, and — from the os hero, which edits the
  // whole meta row under one pencil — the term and role sets too. The marker
  // fields say those sets rode along at all: both are full-replacement writes,
  // so their absence has to mean "leave alone" rather than "clear". They stay
  // Core-only, matching the standalone `terms`/`domains` intents.
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
    if (core && form.get("hasTerms") === "1") {
      await replaceProjectTerms(params.id, form.getAll("termId").map(String));
    }
    if (core && form.get("hasDomains") === "1") {
      await replaceProjectDomains(params.id, form.getAll("domainId").map(String));
    }
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

  if (intent === "domains") {
    await replaceProjectDomains(params.id, form.getAll("domainId").map(String));
    return redirect(`/projects/${params.id}`);
  }

  if (intent === "terms") {
    await replaceProjectTerms(params.id, form.getAll("termId").map(String));
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
    projectCalendar,
    recentActivity,
    epics,
    editableEpics,
    storyDependencies,
    timelineTerms,
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
    projectDriveScope,
  } = useLoaderData() as LoaderData;
  const actionData = useActionData<typeof action>();
  const [scopeSettingsOpen, setScopeSettingsOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerNames = project.partners.map((p) => p.org.name);
  // The dali.os dress for this page: the taller hero, the terms/roles clusters
  // beside the title, and the filled tab plates. Same tabs, same permissions.
  const os = useFeatureFlag("os-redesign");
  // Add ▸ Task on the timeline toolbar opens the board's create form; the two
  // are siblings under Progress, so the signal goes up here and back down.
  const [taskCreateNonce, setTaskCreateNonce] = useState(0);

  // Board people filter — narrows the task board to the chosen people. Lives in
  // the URL (?people=<id,id>) like the board's other filters, so a person-sliced
  // view is a link worth sending. Options are only people who hold tasks.
  const peopleOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const t of tasks) for (const a of t.assignees) byId.set(a.id, a.name);
    return [...byId]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);
  const selectedPeopleIds = useMemo(
    () => (searchParams.get("people") ?? "").split(",").filter(Boolean),
    [searchParams],
  );
  const setSelectedPeopleIds = useCallback(
    (ids: string[]) =>
      setSearchParams(
        (prev) => {
          if (ids.length) prev.set("people", ids.join(","));
          else prev.delete("people");
          return prev;
        },
        { replace: true, preventScrollReset: true },
      ),
    [setSearchParams],
  );

  const tabParam = searchParams.get("tab");
  // Read the param under whichever tab set is live, translating one written in
  // the other. A ?tab=mentorship deep link from a non-mentor would otherwise
  // render an empty body (valid tab, but its content branch is gated) — treat
  // it as invalid and fall back to the default.
  const resolveTab = (): Tab | OsTab => {
    const want = os
      ? isOsTab(tabParam)
        ? tabParam
        : isTab(tabParam)
          ? CLASSIC_TO_OS[tabParam]
          : "progress"
      : isTab(tabParam)
        ? tabParam
        : isOsTab(tabParam)
          ? OS_TO_CLASSIC[tabParam]
          : "overview";
    if (want === "mentorship" && !canViewMentorshipTab) return os ? "progress" : "overview";
    return want;
  };
  const tab = resolveTab();
  // A task bar on the planning timeline opens the task modal, which lives with
  // the board — its own tab classically, folded into Progress under os. Either
  // way this hops to it and sets ?task= in one go.
  const openTaskFromTimeline = (taskId: string) => {
    closeOpenedDocumentTabs();
    setSearchParams(
      (prev) => {
        prev.set("tab", os ? "progress" : "board");
        prev.set("task", taskId);
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  // Sub-tabs are a ?tab= param, so switching one is a navigation and
  // <ScrollRestoration> would land it at the top — you'd lose your place in the
  // page every time you looked at another tab. The tab strip stays put, so the
  // view should too; the other hubs (education, the board's own filters) pass
  // this for the same reason.
  const setTab = (next: Tab | OsTab) => {
    if (next === tab) return;
    closeOpenedDocumentTabs();
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  // Hoisted because both tab sets deal them out differently: classically the
  // timeline lives inside Overview and the board is its own tab; under os both
  // are Progress. One definition each, placed twice.
  const planningNode = (
    <PlanningTab
      projectId={project.id}
      epics={epics}
      editableEpics={editableEpics}
      storyDependencies={storyDependencies}
      timelineTerms={timelineTerms}
      terms={plannedTerms}
      taskCountsByEpic={taskCountsByEpic}
      canEdit={canEdit}
      collabToken={collabToken}
      userName={userName}
      onTaskClick={openTaskFromTimeline}
      // Only on the os Progress tab, where the board is on this same surface
      // for the created task to appear in.
      onAddTask={os ? () => setTaskCreateNonce((n) => n + 1) : undefined}
    />
  );
  const board = (
    <TaskBoard
      projectId={project.id}
      initialTasks={tasks}
      options={boardOptions}
      canManage={canEdit}
      currentUserId={currentUserId}
      currentUserName={userName}
      createNonce={taskCreateNonce}
      // The people filter lives on the board's own toolbar (os), beside search;
      // it only narrows the board's tasks.
      peopleOptions={os ? peopleOptions : []}
      filterPeopleIds={os ? selectedPeopleIds : []}
      onPeopleChange={setSelectedPeopleIds}
    />
  );

  const page = (
    // No column cap: this page fills the width its layout gutters give it, the
    // same as the task board and the partner/public views. The design's 1020px
    // figure was measured on a narrower shell than this one, and capping here
    // left every uncapped block on the page hanging past the right edge.
    <div className={cn("flex flex-col", os ? "gap-6" : "gap-4")}>
      <PresenceBar className="self-end" />

      {/* Overview header — always on top, not behind a tab */}
      <ProjectHeader
        project={project}
        partnerNames={partnerNames}
        canEdit={canEdit}
        canEditScope={canEditScope}
        os={os}
        plannedTerms={plannedTerms}
        allTermOptions={allTermOptions}
        allDomainOptions={allDomainOptions}
      />

      {/* Tab bar. Each section now owns its own edit button — there's no
          page-level edit mode left to clear when switching tabs. */}
      <div
        className={cn(
          "flex items-center border-b border-border",
          os ? "gap-2" : "gap-1",
        )}
      >
        {(os ? OS_TABS : TABS)
          .filter((t) => t !== "mentorship" || canViewMentorshipTab)
          .map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              os
                ? cn(
                    // The design marks the open tab with a filled, top-rounded
                    // plate that meets the rule below it, not an underline.
                    "rounded-t-[10px] px-5 py-2.5 text-base font-medium transition-colors",
                    tab === t
                      ? "bg-os-container text-foreground"
                      : "text-os-grey hover:text-foreground",
                  )
                : `px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    tab === t
                      ? "border-accent-coral text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`
            }
          >
            {os ? OS_TAB_LABELS[t as OsTab] : TAB_LABELS[t as Tab]}
          </button>
        ))}
        {/* Scope/challenge config lives behind this gear, visible only to
            Core/Admin/Staff. */}
        {canViewScope && (
          <Tooltip content="Project settings" className="ml-auto -mb-px">
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

      {(tab === "overview" || tab === "details") && (
        <OverviewTab
          // Under the os tabs the timeline is the Progress tab's own content,
          // so Project details renders without it.
          planning={os ? null : planningNode}
          showMeetings={!os}
          showDocuments={!os}
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

      {/* One panel well for every tab, with a floor under it. Switching tabs
          keeps your scroll position (see setTab's preventScrollReset), but only
          while there is somewhere to keep it: a short tab used to collapse the
          document under the current offset, and the browser clamped you back to
          the top — the header scrolling itself into view again read as the page
          snapping. The floor keeps that scroll range alive.

          It was 70vh, which bought that at the price of most of a screen of
          empty card under Project details — the floor is not free space, it is
          space every tab pays for whether or not it needs it. A quarter of the
          viewport is enough to keep the scroll range alive without the page
          ending in a void. */}
      <div className={cn("flex flex-col", os ? "gap-6 min-h-[25vh]" : "gap-4")}>
        {/* Progress (os): the timeline and the board are one surface — the plan
            above, the work under it — rather than two tabs you flip between to
            answer one question. */}
        {tab === "progress" && (
          <div className="flex flex-col gap-6">
            {planningNode}
            {board}
          </div>
        )}

        {/* Drive (os): the project's files and collab-doc pages in the shared
            DriveBrowser, embedded and scoped to this project. Replaces the
            bespoke DocumentsBlock for the os tab set. */}
        {tab === "drive" && (
          <ProjectDriveTab
            projectId={project.id}
            projectDriveScope={projectDriveScope}
            canEdit={canEdit}
            hasActivePartner={hasActivePartner}
          />
        )}

        {/* Board keys off the raw edit permission, not the page-level Edit-mode
            toggle: epics/sprints/tasks each gate their own inline edit
            affordances, so there's nothing to "turn on" first. */}
        {tab === "board" && board}

        {tab === "mentorship" && canViewMentorshipTab && (
          <ProjectMentorshipTab
            projectId={project.id}
            currentTermId={currentTerm?.id ?? null}
          />
        )}
      </div>
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

/* Chips that edit where they read: the selected set keeps the same shape it
   has outside edit mode, each chip growing an ×, and a + opens the full option
   list. Terms and roles share it so the hero's meta row keeps its height and
   its reading order whether or not the editor is open. */
function HeroChipPicker({
  label,
  options,
  selected,
  onChange,
  chipClass,
  emptyLabel,
}: {
  label: string;
  /** Popover order and chip order both — one list, so nothing reorders on open. */
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  chipClass: (label: string) => string;
  emptyLabel: string;
}) {
  const chosen = options.filter((o) => selected.includes(o.id));
  function toggle(id: string) {
    onChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chosen.length === 0 && (
        <span className="text-[13px] text-os-muted">{emptyLabel}</span>
      )}
      {chosen.map((o) => (
        <span
          key={o.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-full py-[5px] pl-3 pr-1.5 text-[13px] font-semibold",
            chipClass(o.label),
          )}
        >
          {o.label}
          <button
            type="button"
            onClick={() => toggle(o.id)}
            aria-label={`Remove ${o.label}`}
            className="flex h-4 w-4 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Popover
        ariaLabel={`Choose ${label.toLowerCase()}`}
        trigger={
          <button
            type="button"
            aria-label={`Add ${label.toLowerCase()}`}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-os-container-hi text-os-grey transition-colors hover:border-os-grey hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        }
      >
        <div className="flex max-w-[20rem] flex-wrap gap-1.5 p-2">
          {options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(o.id)}
                aria-pressed={on}
                className={cn(
                  "rounded-full px-3 py-1 text-[13px] font-semibold transition-colors",
                  on
                    ? chipClass(o.label)
                    : "bg-os-container/50 text-os-grey hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}

function ProjectHeader({
  project,
  partnerNames,
  canEdit,
  canEditScope = false,
  os = false,
  plannedTerms = [],
  allTermOptions = [],
  allDomainOptions = [],
}: {
  project: LoaderData["project"];
  partnerNames: string[];
  canEdit: boolean;
  // Terms and roles are Core-only even for a staffed member who can rename the
  // project, so the hero editor shows them read-only without it.
  canEditScope?: boolean;
  os?: boolean;
  // The os hero edits terms and roles where they're printed, so it needs the
  // same option lists the Project details segments use. Defaulted empty so the
  // classic header, which doesn't offer that, needn't pass them.
  plannedTerms?: { id: string; code: string }[];
  allTermOptions?: { id: string; code: string }[];
  allDomainOptions?: { id: string; name: string }[];
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [iconEmoji, setIconEmoji] = useState(project.iconEmoji);
  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(project.status);
  const [termIds, setTermIds] = useState<string[]>(() => plannedTerms.map((t) => t.id));
  // What the roles cluster is showing: the declared set, or — when a project
  // has none — the one implied by its bids and assignments, which is what read
  // mode prints (muted). Seeding the editor from the declared list alone made
  // a project whose roles are plainly on screen read "No roles yet" the moment
  // you clicked Edit, and saving from there would have kept it that way.
  const shownDomains =
    project.domains.length > 0 ? project.domains : project.derivedDomains;
  const [domainIds, setDomainIds] = useState<string[]>(() =>
    shownDomains.map((d) => d.id),
  );

  // Every field re-seeds from the loader on open, so a cancelled edit leaves
  // nothing behind and a saved one picks up the revalidated values.
  function openEditor() {
    setIconEmoji(project.iconEmoji);
    setName(project.name);
    setStatus(project.status);
    setTermIds(plannedTerms.map((t) => t.id));
    setDomainIds(shownDomains.map((d) => d.id));
    setEditing(true);
  }

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

  // Chronological, matching the order the read-mode chips print in, so opening
  // the editor doesn't shuffle them.
  const termOptions = [...allTermOptions]
    .reverse()
    .map((t) => ({ id: t.id, label: t.code }));
  // The catalog list, plus any role already on the project that isn't in it —
  // a domain deactivated since it was declared is off the option list, and
  // building the chip row by filtering options would drop it from the editor
  // without ever showing that it is still set.
  const domainOptions = [
    ...allDomainOptions.map((d) => ({ id: d.id, label: d.name })),
    ...shownDomains
      .filter((d) => !allDomainOptions.some((o) => o.id === d.id))
      .map((d) => ({ id: d.id, label: d.name })),
  ];

  // The design's right-hand clusters: TERMS as chips, ROLES as tinted chips.
  // Same two facts the subtitle above states in prose — the "N of M terms"
  // count rides the end of the term row so a partially-scheduled project still
  // reads as one. In edit mode the chips stay put and become selectable, rather
  // than the row vanishing behind a name field.
  const osTagGroup = (
    <div className="flex flex-wrap items-center gap-6">
      <HeroClusterLabel label="Terms">
        {editing && canEditScope ? (
          <HeroChipPicker
            label="Terms"
            options={termOptions}
            selected={termIds}
            onChange={setTermIds}
            chipClass={() => "bg-os-container text-foreground"}
            emptyLabel="No terms yet"
          />
        ) : project.terms.length === 0 ? (
          <span className="text-[13px] text-os-muted">No terms yet</span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {project.terms.map((t) => (
              <span
                key={t.code}
                className="rounded-full bg-os-container px-3 py-[5px] text-[13px] font-semibold text-foreground"
              >
                {t.code}
              </span>
            ))}
          </div>
        )}
        <span className="text-xs text-os-grey">
          {editing && canEditScope
            ? `${termIds.length} of ${project.termCount} expected`
            : termCountLabel}
        </span>
      </HeroClusterLabel>

      <HeroClusterLabel label="Roles">
        {editing && canEditScope ? (
          <HeroChipPicker
            label="Roles"
            options={domainOptions}
            selected={domainIds}
            onChange={setDomainIds}
            chipClass={osRoleChipClass}
            emptyLabel="No roles yet"
          />
        ) : project.domains.length === 0 && project.derivedDomains.length === 0 ? (
          <span className="text-[13px] text-os-muted">No roles yet</span>
        ) : (
          // A role is a role: the set derived from bids and assignments (a
          // project staffed before anyone declared its domains) wears the same
          // colours as a declared one. Muting it left every chip in the hero
          // grey until someone opened the editor and saved — a distinction
          // this header was not otherwise making.
          <DomainChips
            items={project.domains.length > 0 ? project.domains : project.derivedDomains}
            os
          />
        )}
      </HeroClusterLabel>
    </div>
  );

  // Hoisted so both header layouts place the same controls: the default puts
  // them alone on the right, the os layout groups them with the tag clusters.
  const editControls = (
    <div className="flex items-center gap-1.5 shrink-0">
      {/* Classic keeps a header Schedule-meeting button; under os this folds
          into the Progress toolbar's New ▸ Meeting. */}
      {!editing && !os && (
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
            <Tooltip content="Cancel">
              <button
                type="button"
                onClick={() => setEditing(false)}
                aria-label="Cancel"
                className="inline-flex items-center justify-center p-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="Save">
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
          <Tooltip content="Edit">
            <button
              type="button"
              onClick={openEditor}
              aria-label={
                os && canEditScope
                  ? "Edit project name, status, terms and roles"
                  : "Edit project name and status"
              }
              className="inline-flex items-center justify-center p-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        ))}
    </div>
  );

  // One form for the whole hero: name, status and icon always, plus the term
  // and role sets when the viewer may change them. The marker fields tell the
  // action those sets rode along at all — without them (classic header, or a
  // staffed non-Core member) it leaves them untouched rather than clearing
  // them, since both are full-replacement writes.
  const titleCluster = editing ? (
    <Form
      method="post"
      ref={formRef}
      className="flex items-center gap-2 flex-wrap"
    >
      <input type="hidden" name="intent" value="header" />
      <input type="hidden" name="iconEmoji" value={iconEmoji ?? ""} />
      <input type="hidden" name="status" value={status} />
      {os && canEditScope && (
        <>
          <input type="hidden" name="hasTerms" value="1" />
          <input type="hidden" name="hasDomains" value="1" />
          {termIds.map((id) => (
            <input key={id} type="hidden" name="termId" value={id} />
          ))}
          {domainIds.map((id) => (
            <input key={id} type="hidden" name="domainId" value={id} />
          ))}
        </>
      )}
      <ProjectIconPicker iconEmoji={iconEmoji} editing onChange={setIconEmoji} />
      <input
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Project name"
        autoFocus
        // Sized to the name it holds so the title doesn't jump to a box of some
        // other width the moment you click the pencil.
        style={os ? { width: `${Math.max(name.length, 8) + 1}ch` } : undefined}
        className={cn(
          "font-heading text-foreground bg-transparent max-w-full focus:outline-none",
          os
            ? "text-[32px] font-medium border-b border-os-container-hi focus:border-os-accent"
            : "text-xl font-bold px-2 py-1 border border-border rounded-md bg-background focus:ring-2 focus:ring-accent-coral/30",
        )}
      />
      <Select
        value={status}
        onChange={(v) => setStatus(v as (typeof STATUSES)[number])}
        ariaLabel="Project status"
        options={STATUSES.map((s) => ({ value: s, label: s }))}
        buttonClassName={
          os
            ? "rounded-full border border-os-container-hi px-3 py-[5px] text-xs font-semibold text-os-grey inline-flex items-center gap-1 transition-colors hover:text-foreground"
            : "text-xs px-2 py-1 border border-border rounded-full bg-background text-muted-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
        }
      />
    </Form>
  ) : (
    <>
      {/* Real project icon at the title's own size — the design
          prints the emoji inline with the heading. */}
      <ProjectIcon iconEmoji={project.iconEmoji} size={os ? "inherit" : "lg"} />
      <h1
        className={cn(
          "font-heading text-foreground",
          os ? "text-[32px] font-medium" : "text-2xl font-bold",
        )}
      >
        {project.name}
      </h1>
      <StatusBadge status={project.status} os={os} />
    </>
  );

  return (
    <header className={cn("flex flex-col", os ? "gap-6" : "gap-4")}>
      <ProjectImageBanner
        projectId={project.id}
        projectName={project.name}
        initialPreviewUrl={project.imageUrlResolved}
        canEdit={canEdit}
        frameClassName={os ? "h-[275px] rounded-os-card" : undefined}
      />
      <div className="min-w-0 flex-1">
        {/* The edit control is its own column at the far right, outside the
            row that wraps: while it rode along with the tag clusters it got
            pushed onto a line of its own under Roles as soon as they filled
            the row, and opening the editor re-flowed the clusters with it. */}
        <div className={cn("flex items-start justify-between", os ? "gap-4" : "gap-3")}>
          <div
            className={cn(
              "min-w-0 flex-1",
              os && "flex flex-wrap items-center justify-between gap-x-6 gap-y-4",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">{titleCluster}</div>

              {/* Domains sit on their own row under the title. Sharing the
                  title's wrapped flex row meant they trailed off the end of the
                  name and broke to an arbitrary place as it grew. */}
              {!editing &&
                !os &&
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

            {/* os: the design's hero-meta row — title left, the term and role
                clusters right, both inside the wrapping column. */}
            {os && osTagGroup}
          </div>
          {editControls}
        </div>
        {!os && subtitle}
      </div>
    </header>
  );
}

/* The label a hero cluster wears (TERMS, ROLES) with its contents beside it. */
function HeroClusterLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs font-semibold tracking-widest text-os-grey uppercase">
        {label}
      </span>
      {children}
    </div>
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
  const { os, panel } = useOsChrome();

  return (
    <EditableSection
      title="Description"
      icon={<FileText className="w-4 h-4" />}
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) =>
        editing ? (
          // Edits on the same card the description reads on, in the design's
          // field dress — not a differently-shaped form dropped in its place.
          <Form
            method="post"
            ref={formRef}
            className={cn("flex flex-col gap-1.5", os && cn(panel, "os-form p-5"))}
          >
            <input type="hidden" name="intent" value="description" />
            <textarea
              name="description"
              rows={6}
              defaultValue={description ?? ""}
              placeholder="Add a short description… (Markdown supported)"
              className={
                os
                  ? "w-full resize-y"
                  : "px-2 py-1.5 text-sm font-mono border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              }
              autoFocus
            />
          </Form>
        ) : (
          <div className={os ? cn(panel, "p-5") : undefined}>
            {description ? (
              <Markdown>{description}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description.
              </p>
            )}
          </div>
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
// One label/value row of the os Project-details read view: a muted label with
// its glyph on the left, the value right-aligned.
function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-os-container py-3 last:border-0">
      <span className="flex items-center gap-2.5 text-sm text-os-grey">
        {icon}
        {label}
      </span>
      <div className="min-w-0 text-right text-sm text-foreground">{children}</div>
    </div>
  );
}

// The os read view of Project details: a compact icon/label row list with the
// less-common fields folded behind "Additional details". The edit form is
// unchanged — this only replaces the read layout under the os tab set.
function DetailsReadOs({
  project,
  canEditFinance,
}: {
  project: LoaderData["project"];
  canEditFinance: boolean;
}) {
  const [showMore, setShowMore] = useState(false);
  const repoName = (url: string) => url.replace(/\/+$/, "").split("/").pop() || url;
  const dash = <span className="text-os-muted">—</span>;
  const ic = "h-[17px] w-[17px] text-os-grey";

  return (
    <div className="rounded-os-card bg-os-card px-5">
      <DetailRow icon={<Mail className={ic} />} label="Calendar email">
        {project.calendarEmail ? (
          <a
            href={`mailto:${project.calendarEmail}`}
            className="text-accent-coral hover:underline break-all"
          >
            {project.calendarEmail}
          </a>
        ) : (
          dash
        )}
      </DetailRow>

      <DetailRow icon={<Github className={ic} />} label="GitHub team">
        {project.githubTeamSlug ?? dash}
      </DetailRow>

      <DetailRow icon={<Slack className={ic} />} label="Slack channel">
        {project.slackChannelName && project.slackChannelId ? (
          <a
            href={`https://slack.com/app_redirect?channel=${project.slackChannelId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent-coral hover:underline"
          >
            #{project.slackChannelName}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : project.slackChannelName ? (
          `#${project.slackChannelName}`
        ) : (
          dash
        )}
      </DetailRow>

      <DetailRow icon={<Layers className={ic} />} label="Repositories">
        {project.repoUrls.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {project.repoUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-os-container px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:text-accent-coral"
              >
                {repoName(url)}
              </a>
            ))}
          </div>
        ) : (
          dash
        )}
      </DetailRow>

      <DetailRow icon={<Globe className={ic} />} label="Deployment">
        {project.deploymentUrl ? (
          <a
            href={project.deploymentUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent-coral hover:underline break-all"
          >
            {project.deploymentUrl.replace(/^https?:\/\//, "")}
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
          </a>
        ) : (
          dash
        )}
      </DetailRow>

      <div className="border-t border-os-container">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="flex w-full items-center gap-1.5 py-2.5 text-sm text-os-grey transition-colors hover:text-foreground"
        >
          {showMore ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Additional details
        </button>
        {showMore && (
          <div className="pb-1">
            {project.teamGroupEmail && (
              <DetailRow icon={<Users className={ic} />} label="Team email group">
                <a
                  href={`mailto:${project.teamGroupEmail}`}
                  className="text-accent-coral hover:underline break-all"
                >
                  {project.teamGroupEmail}
                </a>
              </DetailRow>
            )}
            <DetailRow icon={<CalendarDays className={ic} />} label="Terms required">
              {project.termCount} {project.termCount === 1 ? "term" : "terms"}
            </DetailRow>
            {canEditFinance && (project.chartStringType || project.chartString) && (
              <DetailRow icon={<Info className={ic} />} label="Payroll">
                <span className="break-all font-mono text-xs">
                  {[project.chartStringType, project.chartString]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </DetailRow>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* The same row, with a field where the value was. Stacks on a narrow screen so
   an input never has to share a line with its own label. */
function DetailEditRow({
  icon,
  label,
  hint,
  children,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-os-container py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2.5 text-sm text-os-grey">
          {icon}
          {label}
        </span>
        {hint && <span className="pl-[27px] text-xs text-os-muted">{hint}</span>}
      </span>
      <div className="w-full sm:max-w-[24rem]">{children}</div>
    </div>
  );
}

/* Project details in edit mode: the read view's own card and rows, with each
   value swapped for its field. Every field the `details` intent writes is
   rendered — that write replaces the whole set, so a field left out of the
   form would be cleared rather than kept. That is also why nothing here hides
   behind a disclosure the way the read view's "Additional details" does. */
function DetailsEditOs({
  project,
  canEditFinance,
}: {
  project: LoaderData["project"];
  canEditFinance: boolean;
}) {
  const ic = "h-[17px] w-[17px] text-os-grey";
  const field = "w-full";

  return (
    <div className="rounded-os-card bg-os-card px-5">
      <DetailEditRow icon={<Mail className={ic} />} label="Calendar email">
        <input
          name="calendarEmail"
          type="email"
          defaultValue={project.calendarEmail ?? ""}
          placeholder="projectname@dali.dartmouth.edu"
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Github className={ic} />} label="GitHub team">
        <input
          name="githubTeamSlug"
          type="text"
          defaultValue={project.githubTeamSlug ?? ""}
          placeholder="project-team-name"
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Slack className={ic} />} label="Slack channel">
        <input
          name="slackChannelName"
          type="text"
          defaultValue={project.slackChannelName ?? ""}
          placeholder="project-name"
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow
        icon={<Layers className={ic} />}
        label="Repositories"
        hint="One URL per line"
      >
        <textarea
          name="repoUrls"
          rows={3}
          defaultValue={project.repoUrls.join("\n")}
          placeholder="https://github.com/dali-lab/…"
          className={cn(field, "resize-y font-mono")}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Globe className={ic} />} label="Deployment">
        <input
          name="deploymentUrl"
          type="url"
          defaultValue={project.deploymentUrl ?? ""}
          placeholder="https://projectname.fly.dev"
          className={cn(field, "font-mono")}
        />
      </DetailEditRow>

      {/* Provisioned by the staffing "Create team email group" automation —
          shown for context, not lead-editable. */}
      <DetailEditRow icon={<Users className={ic} />} label="Team email group">
        <p className="text-sm text-foreground sm:text-right">
          {project.teamGroupEmail ?? (
            <span className="text-os-muted">Not created yet — run staffing finalize.</span>
          )}
        </p>
      </DetailEditRow>

      <DetailEditRow
        icon={<CalendarDays className={ic} />}
        label="Terms required"
        hint="The planned span, not the terms staffed so far"
      >
        <input
          name="termCount"
          type="number"
          min={1}
          defaultValue={project.termCount}
          className={field}
        />
      </DetailEditRow>

      {canEditFinance && (
        <>
          <DetailEditRow icon={<Info className={ic} />} label="Payroll type">
            <input
              name="chartStringType"
              type="text"
              defaultValue={project.chartStringType ?? ""}
              placeholder="e.g. Grant, Department"
              className={field}
            />
          </DetailEditRow>
          <DetailEditRow icon={<Info className={ic} />} label="Full chart string">
            <input
              name="chartString"
              type="text"
              defaultValue={project.chartString ?? ""}
              placeholder="full GL chart string"
              className={cn(field, "font-mono")}
            />
          </DetailEditRow>
        </>
      )}
    </div>
  );
}

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
  const os = useFeatureFlag("os-redesign");

  return (
    <EditableSection
      title="Project details"
      icon={<Info className="w-4 h-4" />}
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) =>
        os ? (
          editing ? (
            <Form method="post" ref={formRef} className="os-form w-full">
              <input type="hidden" name="intent" value="details" />
              <DetailsEditOs project={project} canEditFinance={canEditFinance} />
            </Form>
          ) : (
            <DetailsReadOs project={project} canEditFinance={canEditFinance} />
          )
        ) : (
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

// The design gives each role its own tinted chip. The four hues it drew were
// matched by name against a handful of short keys and everything else fell to
// a hash across those same four — so with the real catalog (17 domains, whose
// labels are "Fullstack Dev", "UI/UX Design", "Product Management"…) every
// lookup missed and three unrelated domains routinely came out the same
// colour. Each catalog domain now names its own hue, so a role reads
// identically on the header, the team cards, and anywhere else it appears.
const OS_ROLE_CHIPS = {
  amber: "bg-[#3d3a26] text-[#e8dd9a]",
  teal: "bg-[#1f3a37] text-[#8fd6cb]",
  violet: "bg-[#31284a] text-[#c3aef2]",
  pink: "bg-[#3f2530] text-[#f2a8bd]",
  blue: "bg-[#1e3348] text-[#a2d2fd]",
  green: "bg-[#263a29] text-[#a6dda6]",
  orange: "bg-[#43301f] text-[#f0b98a]",
  magenta: "bg-[#3d2440] text-[#e2a6ee]",
  slate: "bg-[#2b3340] text-[#aec4de]",
  cyan: "bg-[#193a3f] text-[#8fd4e0]",
  red: "bg-[#3f2424] text-[#f0a5a5]",
  lime: "bg-[#333d1f] text-[#cfe08a]",
  indigo: "bg-[#2a2c4d] text-[#b0b4f0]",
  sand: "bg-[#3a3128] text-[#ddc3a3]",
} as const;

// Matched as a prefix of the domain's normalised name, so a domain's catalog
// label, its legacy name and its code all land on one hue — the header reads
// `displayName` ("Fullstack Dev") while a team card reads `name`
// ("Fullstack"), and the two have to agree. Longest first: "production" would
// otherwise be swallowed by "product".
const OS_ROLE_STEMS: [string, keyof typeof OS_ROLE_CHIPS][] = [
  ["threedmodeling", "green"],
  ["3dmodeling", "green"],
  ["videography", "cyan"],
  ["photography", "red"],
  ["digitalarts", "sand"],
  ["engineering", "slate"],
  ["production", "lime"],
  ["fullstack", "teal"],
  ["animation", "orange"],
  ["graphics", "magenta"],
  ["product", "violet"],
  ["writing", "indigo"],
  ["design", "pink"],
  ["arvr", "blue"],
  ["uiux", "pink"],
  ["data", "amber"],
  ["dev", "teal"],
  ["pm", "violet"],
  ["ux", "pink"],
];

// An unlisted domain still gets a stable colour without anyone editing the
// table above — off the whole ring now, not off four slots.
const OS_ROLE_CHIP_RING = Object.values(OS_ROLE_CHIPS);

function osRoleChipClass(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [stem, hue] of OS_ROLE_STEMS) {
    if (key.startsWith(stem)) return OS_ROLE_CHIPS[hue];
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 997;
  return OS_ROLE_CHIP_RING[hash % OS_ROLE_CHIP_RING.length];
}

function DomainChips({
  items,
  muted = false,
  os = false,
}: {
  items: { id: string; name: string }[];
  muted?: boolean;
  os?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((d) => (
        <span
          key={d.id}
          className={
            os
              ? cn(
                  "inline-flex items-center rounded-full px-3.5 py-[5px] text-[13px] font-semibold",
                  muted ? "bg-os-container text-os-grey" : osRoleChipClass(d.name),
                )
              : `inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${
                  muted
                    ? "bg-muted text-muted-foreground"
                    : "bg-blue-50 text-blue-700 border border-blue-100"
                }`
          }
        >
          {d.name}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({
  status,
  os = false,
}: {
  status: (typeof STATUSES)[number];
  os?: boolean;
}) {
  const palette: Record<(typeof STATUSES)[number], string> = {
    Active: "bg-accent-teal/15 text-accent-teal border-accent-teal/40",
    Paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/40",
    Archived: "bg-muted/50 text-muted-foreground border-border",
  };
  // The design's status tag — the same plate the project cards wear over their
  // cover, so a project reads the same in the grid and on its own page.
  const osPalette: Record<(typeof STATUSES)[number], string> = {
    Active: "bg-os-bg/85 text-os-green border-os-green/35",
    Paused: "bg-os-bg/85 text-os-amber border-os-amber/35",
    Archived: "bg-os-bg/85 text-os-grey border-os-grey/35",
  };
  return (
    <span
      className={
        os
          ? `rounded-full border px-3 py-[5px] text-xs font-semibold ${osPalette[status]}`
          : `text-[11px] px-2 py-0.5 rounded-full border font-medium ${palette[status]}`
      }
    >
      {status}
    </span>
  );
}

/* One term's roster. Split out of TeamSection because the current term renders
   at the top level and the older ones render inside the "Previous teams"
   folder — same markup, two places. */
function TeamTermGroup({
  team,
  canEdit,
  currentTermCode,
  os,
}: {
  team: LoaderData["teams"][number];
  canEdit: boolean;
  currentTermCode: string | null;
  os: boolean;
}) {
  return (
    <div>
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
      {os ? (
        // The design's member cards: avatar, name, and the role as plain text.
        // The level itself is not shown — P1/P2/P3 is an internal ladder, and
        // the only part of it this page needs to say is who mentors each
        // domain, which is the domain's P3.
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {team.members.map((m) => (
            <div
              key={m.assignmentId}
              className="flex items-center gap-3 rounded-os-item bg-os-card p-3"
            >
              <Avatar photoUrl={m.photoUrl} name={m.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {m.name}
                </div>
                <div className="truncate text-[12px] text-os-muted">
                  {m.domain}
                </div>
              </div>
              {m.level === "P3" &&
                (canEdit ? (
                  <Link
                    to={`/members/${m.userId}#project-assignments`}
                    title={`Change ${m.name}'s level on their profile`}
                    className="flex-shrink-0 rounded-full bg-os-accent/15 px-2 py-0.5 text-[11px] font-semibold text-os-accent transition-colors hover:bg-os-accent/25"
                  >
                    Mentor
                  </Link>
                ) : (
                  <span className="flex-shrink-0 rounded-full bg-os-accent/15 px-2 py-0.5 text-[11px] font-semibold text-os-accent">
                    Mentor
                  </span>
                ))}
            </div>
          ))}
        </div>
      ) : (
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
                <Link
                  to={`/members/${m.userId}#project-assignments`}
                  title={`Change ${m.name}'s level on their profile`}
                  className="text-muted-foreground hover:text-foreground hover:underline underline-offset-2 rounded transition-colors"
                >
                  {m.level}
                </Link>
              ) : (
                <span className="text-muted-foreground">{m.level}</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
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
  const [showPrevious, setShowPrevious] = useState(false);
  const { os, sectionTitle } = useOsChrome();
  // teams is pre-sorted newest term first by the loader, so the head is the
  // roster the page is about and the tail is history.
  const [currentTeam, ...previousTeams] = teams;

  return (
    <div className="flex flex-col gap-2">
      <h2
        className={
          os ? sectionTitle : "text-sm font-semibold text-foreground flex items-center gap-2"
        }
      >
        {!os && <Users className="w-4 h-4" />} Team
      </h2>
      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No team assignments yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <TeamTermGroup
            team={currentTeam}
            canEdit={canEdit}
            currentTermCode={currentTermCode}
            os={os}
          />

          {/* Past terms live in a folder rather than in the roster: a project
              that has run for eight terms otherwise buries this term's team
              under seven that have moved on. */}
          {previousTeams.length > 0 && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setShowPrevious((v) => !v)}
                aria-expanded={showPrevious}
                className={
                  os
                    ? "flex w-full items-center gap-2 rounded-os-item bg-os-card px-3 py-2.5 text-left text-sm font-semibold text-os-grey transition-colors hover:text-foreground"
                    : "flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {showPrevious ? (
                  <ChevronDown className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 flex-shrink-0" />
                )}
                <Folder className="h-4 w-4 flex-shrink-0" />
                Previous teams
                <span className="ml-auto text-xs font-semibold text-os-muted">
                  {previousTeams.length}
                </span>
              </button>
              {showPrevious &&
                previousTeams.map((team) => (
                  <TeamTermGroup
                    key={team.code}
                    team={team}
                    canEdit={canEdit}
                    currentTermCode={currentTermCode}
                    os={os}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* The project's upcoming meetings. A card inside Overview classically; the
   whole body of the Meetings tab under the os tab set, where it carries an
   empty state because a tab you can click and get nothing from reads as
   broken in a way a hidden card never did. */
function MeetingsSection({
  meetings,
  calendar,
  projectId,
  standalone = false,
}: {
  meetings: LoaderData["upcomingMeetings"];
  // Present only on the standalone Meetings tab — the loader builds the grid
  // for that tab alone.
  calendar?: LoaderData["projectCalendar"];
  projectId?: string;
  standalone?: boolean;
}) {
  const tz = useUserTimeZone();

  const grid =
    calendar && projectId ? (
      <MonthCalendarPanel
        days={calendar.monthDays}
        events={calendar.events}
        monthOffset={calendar.monthOffset}
        monthLabel={calendar.monthLabel}
        timeZone={calendar.timeZone}
        basePath={`/projects/${projectId}?tab=meetings`}
        sourceLabel={
          calendar.calendarEmail
            ? `${calendar.calendarEmail} · epic and story deadlines`
            : "Project meetings · epic and story deadlines"
        }
      />
    ) : null;

  if (meetings.length === 0) {
    if (!standalone) return null;
    return (
      <div className="flex flex-col gap-4">
        {grid}
        <section className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {calendar && !calendar.calendarEmail
            ? "No meetings scheduled for this project. Set a calendar email in Details to tie this grid to the project's calendar identity."
            : "No meetings scheduled for this project."}
        </section>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {grid}
    <section className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
        <CalendarDays className="w-4 h-4" /> Meetings
      </h2>
      <div className="flex flex-col divide-y divide-border">
        {meetings.map((m) => (
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
    </div>
  );
}

/* One domain's challenge for a term. Folded by default: a project declares up
   to eight domains and their scopes run to paragraphs, so leaving every one of
   them open buried the sections under it. The domain name is the affordance. */
function ChallengeDomain({
  domainName,
  scope,
}: {
  domainName: string;
  scope: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-[15px] font-semibold text-foreground transition-colors hover:text-accent-coral"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
        {domainName}
      </button>
      {open && (
        <p className="mt-1 whitespace-pre-wrap pl-[22px] text-sm text-foreground">
          {scope}
        </p>
      )}
    </div>
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
  showMeetings = true,
  showDocuments = true,
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
  // False under the os tab set, where meetings ride the Progress timeline.
  showMeetings?: boolean;
  // False under the os tab set, where the project's files are their own
  // "Drive" tab rather than a block at the bottom of Project details.
  showDocuments?: boolean;
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
  // Under dali.os a section is a title over its content, not a box around it —
  // so the cards these sections hold stop showing a second border inside a first.
  const { os, sectionShell, sectionTitle, panel } = useOsChrome();

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
          <section className={sectionShell}>
            <div className="flex items-center justify-between">
              <h3 className={os ? sectionTitle : "text-sm font-semibold text-foreground"}>
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
            {/* The body takes the surface under os; the section around it is
                only a title, so this is the one card here. */}
            <div className={os ? cn(panel, "p-4") : undefined}>
              {currentChallenges.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {currentChallenges.map((c) => (
                    <ChallengeDomain
                      key={c.domainId}
                      domainName={c.domainName}
                      scope={c.scope}
                    />
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
                    <div className="flex flex-col gap-2">
                      {g.cells.map((c) => (
                        <ChallengeDomain
                          key={c.domainId}
                          domainName={c.domainName}
                          scope={c.scope}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
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
      <section className={sectionShell}>
        <TeamSection
          teams={teams}
          canEdit={canEditAssignmentLevel}
          currentTermCode={currentTerm?.code ?? null}
        />
      </section>

      {/* Next scheduled meetings for this project. Under the os tabs this is a
          tab of its own, so Overview stops rendering it here. */}
      {showMeetings && <MeetingsSection meetings={upcomingMeetings} />}

      {/* Drive — the project's one file surface: collab-doc pages and uploaded
          files together in one folder tree. Files render inline (root-level
          at the bottom, folder-placed nested under the matching folder). Under
          the os tab set this is lifted out to a "Drive" tab of its own. */}
      {showDocuments && (
        <DocumentsBlock
          projectId={project.id}
          documents={documents}
          pinnedDocuments={pinnedDocuments}
          files={files}
          fileEpics={fileEpics}
          canEdit={canEdit}
          hasActivePartner={hasActivePartner}
        />
      )}

      {/* Recent project-scoped audit activity — editors only (the loader
          returns an empty list otherwise). Read-only. */}
      {canEdit && recentActivity.length > 0 && (
        <section className={sectionShell}>
          <h2
            className={
              os ? sectionTitle : "text-sm font-semibold text-foreground flex items-center gap-2"
            }
          >
            {!os && <History className="w-4 h-4" />} Recent activity
          </h2>
          <ul className={cn("flex flex-col gap-2", os && cn(panel, "p-4"))}>
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
// reusable template. Posts to the /projects action (intent=capture). Rendered
// for Core (canEditScope) as a sibling of the Danger zone in the settings modal.
function SaveAsTemplateSection({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
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

// Per-contact "⋯" menu in the os Partners view: email the person, or (Core)
// jump to their organization in the CRM.
function PartnerContactMenu({
  name,
  email,
  orgId,
  canManage,
}: {
  name: string;
  email: string | null;
  orgId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass =
    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-os-container";
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-os-grey transition-colors hover:bg-os-container hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-[100] min-w-[184px] rounded-xl border border-os-container bg-os-card p-1.5 shadow-[0_12px_32px_var(--color-os-shadow)]"
        >
          {email && (
            <a role="menuitem" href={`mailto:${email}`} className={itemClass} onClick={() => setOpen(false)}>
              <Mail className="h-4 w-4 text-os-grey" /> Email
            </a>
          )}
          {canManage && (
            <Link role="menuitem" to={`/partners/${orgId}`} className={itemClass} onClick={() => setOpen(false)}>
              <ExternalLink className="h-4 w-4 text-os-grey" /> View organization
            </Link>
          )}
          {!email && !canManage && (
            <span className="block px-2.5 py-2 text-sm text-os-muted">No actions</span>
          )}
        </div>
      )}
    </div>
  );
}

// The os Partners view: the people (contacts across the linked orgs) up front,
// with org lifecycle management (end / unlink) folded behind a Core-only
// "Organizations" disclosure so the capability isn't lost.
function PartnersContactsOs({
  partners,
  canManage,
  tz,
  confirmSubmit,
}: {
  partners: LoaderData["project"]["partners"];
  canManage: boolean;
  tz: string;
  confirmSubmit: ReturnType<typeof useConfirmSubmit>;
}) {
  const [showOrgs, setShowOrgs] = useState(false);
  const contacts = partners
    .filter((p) => !p.endedAt)
    .flatMap((p) =>
      p.org.contacts.map((c) => ({ ...c, orgId: p.org.id, orgName: p.org.name })),
    );

  return (
    // The design's partner directory: one surface, a row per contact. The
    // section around it carries no border of its own, so this is where the
    // list gets its ground.
    <div className="rounded-os-card bg-os-card px-5">
      {contacts.length === 0 ? (
        <p className="py-4 text-sm text-os-muted italic">No partner contacts yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-os-container">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={c.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
                <div className="truncate text-xs text-os-grey">
                  {c.displayRole ?? "Partner contact"}
                </div>
              </div>
              <PartnerContactMenu
                name={c.name}
                email={c.email}
                orgId={c.orgId}
                canManage={canManage}
              />
            </div>
          ))}
        </div>
      )}

      {canManage && partners.length > 0 && (
        <div className="border-t border-os-container pt-1 pb-1">
          <button
            type="button"
            onClick={() => setShowOrgs((v) => !v)}
            aria-expanded={showOrgs}
            className="flex w-full items-center gap-1.5 py-1.5 text-xs font-medium text-os-grey transition-colors hover:text-foreground"
          >
            {showOrgs ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Organizations ({partners.length})
          </button>
          {showOrgs && (
            <div className="flex flex-col divide-y divide-os-container">
              {partners.map((p) => (
                <div key={p.id} className="flex items-center gap-2 py-2">
                  <Link
                    to={`/partners/${p.org.id}`}
                    className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
                  >
                    {p.org.name}
                  </Link>
                  {p.endedAt ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/50 text-muted-foreground">
                      Ended {formatDateShort(p.endedAt, tz)}
                    </span>
                  ) : p.startedAt ? (
                    <span className="text-xs text-muted-foreground">
                      since {formatDateShort(p.startedAt, tz)}
                    </span>
                  ) : null}
                  {!p.endedAt && (
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
                      <Tooltip content="End partnership (keeps the record)">
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
                    <Tooltip content="Unlink organization (erases the record)">
                      <button
                        type="submit"
                        aria-label="Unlink organization"
                        className="inline-flex items-center justify-center p-1.5 rounded-md text-destructive hover:bg-destructive/10 flex-shrink-0"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </Form>
                </div>
              ))}
            </div>
          )}
        </div>
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
  const { os, sectionShell, sectionTitle } = useOsChrome();

  return (
    <section className={sectionShell}>
      <div className="flex items-center justify-between">
        <h2
          className={
            os ? sectionTitle : "text-sm font-semibold text-foreground flex items-center gap-2"
          }
        >
          {!os && <Handshake className="w-4 h-4" />} Partners
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
        <Form method="post" className="flex flex-wrap items-end gap-3 bg-muted/20 rounded-lg p-3">
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

      {os ? (
        <PartnersContactsOs
          partners={partners}
          canManage={canManage}
          tz={tz}
          confirmSubmit={confirmSubmit}
        />
      ) : partners.length === 0 ? (
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
                  <Tooltip content="End partnership (keeps the record)">
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
                  <Tooltip content="Unlink organization (erases the record)">
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
          <Tooltip content="Shared with partner">
            <span className="flex items-center text-accent-teal">
              <Handshake className="w-3.5 h-3.5" />
            </span>
          </Tooltip>
        )}
        {doc.publicVisible && (
          <Tooltip content="Public write-up — rendered on this project's page on dali.website">
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

// ── ProjectDriveTab ──────────────────────────────────────────────────────────
// Renders the shared DriveBrowser locked to this project's scope. Replaces the
// bespoke DocumentsBlock for the os tab set's "Drive" tab.
//
// Trade-off (callers must be aware):
//   • Epic-grouping of uploaded files (previously via `fileEpics` in
//     DocumentsBlock) is NOT present here. Files are positioned in the folder
//     tree by their real Drive placement (folderPageId), which is the consistent
//     Drive model across the whole app. Epic-grouping was a DocumentsBlock-only
//     feature and is intentionally not ported into the shared browser.
//
// What IS preserved:
//   • Partner-visibility toggle (Share with partner / Stop sharing) on docs and
//     files, shown when the project has an active partner and canEdit is true.
//   • Doc title change sync via postMessage revalidation.
//   • All DriveBrowser capabilities: list/grid/columns, DnD, context menus,
//     multi-select, bulk, tags, search, rename, move, delete, favorites.

function ProjectDriveTab({
  projectId,
  projectDriveScope,
  canEdit,
  hasActivePartner,
}: {
  projectId: string;
  projectDriveScope: DriveTreeScope;
  canEdit: boolean;
  hasActivePartner: boolean;
}) {
  const dialog = useDialog();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const scopeId = projectDriveScope.id;

  // Sync doc-title changes made in the split-pane editor back to this listing.
  // DocumentsBlock used the same mechanism (postMessage from the editor shell).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; pageId?: string } | undefined;
      if (data?.type !== "dali:documentTitleChanged") return;
      const pageIds = new Set(projectDriveScope.items.map((i) => i.id));
      if (!data.pageId || !pageIds.has(data.pageId)) return;
      revalidator.revalidate();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [projectDriveScope.items, revalidator]);

  // Toggle partner visibility for a page (doc/folder). Posts to the same
  // endpoint DocumentsBlock used, then revalidates so the badge updates.
  const togglePagePartnerVisible = useCallback(async (item: DriveItem, next: boolean) => {
    if (item.type !== "doc" && item.type !== "file") return;
    if (next) {
      const confirmed = await dialog.confirm({
        title: "Share with partner?",
        description:
          "Partner organization members will be able to view this item. This takes effect immediately.",
        confirmLabel: "Share",
      });
      if (!confirmed) return;
    }
    const endpoint =
      item.type === "file"
        ? `/api/files/${item.id}/partner-visible`
        : `/api/pages/${item.id}/partner-visible`;
    try {
      const res = await fetch(endpoint, {
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
    } catch {
      // Silently fail — the user can retry. The badge state is loader-authoritative.
    }
  }, [dialog, revalidator]);

  const onNavigate = useCallback(
    (_scopeId: string | null, folderId: string | null) => {
      setCurrentFolderId(folderId);
    },
    [],
  );

  const onOpenItem = useCallback(
    (item: DriveItem) => {
      if (item.href) navigate(item.href);
    },
    [navigate],
  );

  const onMove = useCallback(
    async (_scopeId: string, item: DriveItem, destFolderId: string | null) => {
      // Pages move via POST /api/pages/:id/move; files use the unified
      // POST /api/drive/move endpoint introduced in Drive Wave 3.
      const isFile = item.type === "file";
      try {
        let res: Response;
        if (isFile) {
          res = await fetch("/api/drive/move", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemType: "file", itemId: item.id, destFolderPageId: destFolderId }),
          });
        } else {
          res = await fetch(`/api/pages/${item.id}/move`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: destFolderId }),
          });
        }
        if (!res.ok) return;
        revalidator.revalidate();
      } catch {
        // Silently fail.
      }
    },
    [revalidator],
  );

  const getScopeActions = useCallback(
    (_scopeId: string): RowActions => ({
      onRename: async (item) => {
        const newTitle = await dialog.prompt({ title: "Rename", label: "New name", defaultValue: item.title || "" }) ?? "";
        if (!newTitle || newTitle === item.title) return;
        const isFile = item.type === "file";
        try {
          let res: Response;
          if (isFile) {
            // Files: POST /api/files/:id with { intent: "rename", title }
            res = await fetch(`/api/files/${item.id}`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intent: "rename", title: newTitle }),
            });
          } else {
            // Docs/folders: POST /api/documents/:id with { title }
            res = await fetch(`/api/documents/${item.id}`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: newTitle }),
            });
          }
          if (!res.ok) return;
          revalidator.revalidate();
        } catch {
          // Silently fail.
        }
      },
      onRequestMove: async (item) => {
        // Move within the project scope is the same as onMove with null dest —
        // handled inline by DnD. A "Move to…" dialog is deferred; for now no-op.
        void item;
      },
      onDelete: async (item) => {
        if (!(await dialog.confirm({ title: `Delete "${item.title || "this item"}"?`, description: "This cannot be undone.", confirmLabel: "Delete", tone: "destructive" }))) return;
        const isFile = item.type === "file";
        try {
          // Files: DELETE /api/files/:id
          // Docs/folders: DELETE /api/documents/:id (soft-archives; guards system folders)
          const endpoint = isFile ? `/api/files/${item.id}` : `/api/documents/${item.id}`;
          const res = await fetch(endpoint, {
            method: "DELETE",
            credentials: "include",
          });
          if (!res.ok) return;
          revalidator.revalidate();
        } catch {
          // Silently fail.
        }
      },
    }),
    [revalidator],
  );

  return (
    <DriveBrowser
      scopes={[projectDriveScope]}
      currentScopeId={scopeId}
      currentFolderId={currentFolderId}
      typeFilter="all"
      search={search}
      onSearchChange={setSearch}
      onNavigate={onNavigate}
      onOpenItem={onOpenItem}
      onMove={onMove}
      getScopeActions={getScopeActions}
      embeddedScopeId={scopeId}
      onTogglePartnerVisible={canEdit ? togglePagePartnerVisible : undefined}
      hasActivePartner={hasActivePartner}
    />
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
    if (next) {
      const confirmed = await dialog.confirm({
        title: "Share with partner?",
        description:
          "Partner organization members will be able to view this document. This takes effect immediately.",
        confirmLabel: "Share",
      });
      if (!confirmed) return;
    }
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
    if (next) {
      const confirmed = await dialog.confirm({
        title: "Share with partner?",
        description:
          "Partner organization members will be able to view this file. This takes effect immediately.",
        confirmLabel: "Share",
      });
      if (!confirmed) return;
    }
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
            <Tooltip content="Shared with partner">
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
                      <Tooltip content="Add document">
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
                      <Tooltip content="Upload file into folder">
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
  terms,
  taskCountsByEpic,
  canEdit,
  collabToken,
  userName,
  onTaskClick,
  onAddTask,
}: {
  projectId: string;
  epics: TimelineEpic[];
  editableEpics: EditableEpic[];
  storyDependencies: StoryDependencyEdge[];
  timelineTerms: TimelineTerm[];
  terms: { id: string; code: string }[];
  taskCountsByEpic: Record<string, { done: number; total: number }>;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
  onTaskClick: (taskId: string) => void;
  onAddTask?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
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
        onTaskClick={onTaskClick}
        onAddTask={onAddTask}
      />
    </div>
  );
}

// Same look as ViewToggle's buttons (the hub's list/cards switch) — that
// component is hardwired to list/card values, so the planning toggle borrows
// its styling rather than its state.

