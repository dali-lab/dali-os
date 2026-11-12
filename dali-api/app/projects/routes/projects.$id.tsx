import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useOpenBeside } from "~/components/side-panel/use-side-panel";
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
import { Select, Menu, InfoTip } from "~/components/ui/floating";
import {
  CalendarDays,
  CalendarX,
  Globe,
  Settings,
  Folder,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  FileText,
  Info,
  Users,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  Unlink,
  MoreHorizontal,
  ExternalLink,
  Mail,
  Github,
  Slack,
  Layers,
  Figma,
  NotebookPen,
  Presentation,
  Shapes,
} from "lucide-react";
import type { DriveTypeFilter } from "~/components/drive/type-filter";
import { useOsChrome } from "~/components/os-chrome";
import { setPageFavorite } from "~/components/favorites-live";
import { DomainChips } from "~/components/DomainChips";
import { ChartStringPanel } from "~/projects/components/ChartStringPanel";
import {
  DetailEditRow,
  DetailRow,
  HeroClusterLabel,
  OS_DETAIL_CARD,
  OS_DETAIL_ICON,
  OsTabBar,
} from "~/components/os-page";
import { cn } from "~/lib/cn";
import { Modal, ModalHeader } from "~/components/Modal";
import { useDialog, useConfirmSubmit } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import { Toggle } from "~/components/ui/Toggle";
import { EditableSection } from "~/components/EditableSection";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import type { Route } from "./+types/projects.$id";
import { MonthCalendarPanel } from "~/components/MonthCalendarPanel";
import { ProjectInfraSection } from "~/projects/components/ProjectInfraSection";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { formatDateShort, formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { Avatar } from "~/components/ui/Avatar";
import { ProjectImageBanner } from "../components/ProjectImageBanner";
import { ProjectViewSwitch } from "../components/ProjectViewSwitch";
import { ProjectIcon } from "~/components/ProjectIcon";
import { ProjectIconPicker } from "../components/ProjectIconPicker";
import { Markdown } from "~/components/Markdown";
import { isCore, isProjectMember, currentTerm } from "~/lib/roles";
import { maintenanceLabel } from "~/partners/lib/partner-renewals";
import { TaskBoard, type TaskCreateSeed } from "../components/TaskBoard";
import { ProjectMentorshipTab } from "~/mentorship/components/ProjectMentorshipTab";
import {
  type TimelineEpic,
  type TimelineTerm,
  type StoryDependencyEdge,
  type EpicDependencyEdge,
  type TaskDependencyEdge,
} from "../components/EpicsTimeline";
import { EpicSprintManager, type EditableEpic } from "../components/EpicSprintManager";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import type { RowActions } from "~/components/drive/DriveBrowser";
import { DRIVE_TOOLBAR_BTN } from "~/components/drive/toolbar";
import { FolderPicker } from "~/components/drive/FolderPicker";
import type { PickerDrive, PickerFolder, Destination } from "~/components/drive/FolderPicker";
import { moveDriveItem, driveErrorFrom } from "~/components/drive/move-item";
import { destinationLabel } from "~/components/drive/action-toast";
import { reportMoveBatch, runHiddenMoveBatch, itemCount } from "~/components/drive/move-batch";
import { withoutHidden, usePendingHidden } from "~/components/drive/pending-hidden";
import { runTrash } from "~/components/drive/trash-batch";
import { DriveHistoryContext, useDriveHistory, useDriveHistoryKeys } from "~/components/drive/use-drive-history";
import { useDriveFileUpload } from "~/components/drive/useDriveFileUpload";
import { DriveUploadInput } from "~/components/drive/DriveUploadInput";
import { useToast } from "~/components/ui/toast";
import { filterPillClass } from "~/components/ui/floating/styles";
import { LEGACY_TAB_TO_TAB } from "../lib/project-tabs";
import { Button } from "~/components/ui/Button";
import { PROJECT_STATUSES, type ProjectStatus } from "../lib/project-lifecycle";
import { loadProjectDetail, type ProjectDetailData } from "../lib/project-detail.server";
import { runProjectDetailAction } from "../lib/project-detail-actions.server";

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
    return [{ label: p.name, to: `/projects/${p.id}`, icon: <ProjectIcon iconEmoji={p.iconEmoji} />, emoji: p.iconEmoji }];
  },
  headerAction: (data: unknown) => {
    const d = data as { project?: { id: string } } | undefined;
    if (!d?.project) return null;
    return <ProjectViewSwitch projectId={d.project.id} current="internal" />;
  },
  favoriteRoute: true,
};


const STATUSES = PROJECT_STATUSES;

// The status plate's colours, shared by the read-only StatusBadge and the
// hero's editable status dropdown so a project's status reads the same whether
// or not you can change it.
const STATUS_PILL_OS: Record<ProjectStatus, string> = {
  Active: "bg-os-bg/85 text-os-green border-os-green/35",
  Paused: "bg-os-bg/85 text-os-amber border-os-amber/35",
  Archived: "bg-os-bg/85 text-os-grey border-os-grey/35",
};

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

export async function loader(args: Route.LoaderArgs) {
  return loadProjectDetail(args);
}

// `tab` and `month` only matter to the Meetings month grid; everything else on
// this page (?task=, ?epic=, ?sprint=, ?view=) is client-only. Every other tab's
// data is loaded up front, so switching to or between them needs no loader run.
const LOADER_SEARCH_PARAMS = ["tab", "month"] as const;

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // Must not swallow an explicit revalidator.revalidate() (same URL), which
  // the page relies on to refresh after a mutation.
  if (
    !formMethod &&
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search !== nextUrl.search
  ) {
    const changed = (key: (typeof LOADER_SEARCH_PARAMS)[number]) =>
      currentUrl.searchParams.get(key) !== nextUrl.searchParams.get(key);
    const needsMeetingsGrid =
      nextUrl.searchParams.get("tab") === "meetings" && LOADER_SEARCH_PARAMS.some(changed);
    return needsMeetingsGrid;
  }
  return defaultShouldRevalidate;
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;

  const core = await isCore(auth.user.sub, request);
  if (!core && !(await isProjectMember(auth.user.sub, params.id, request))) {
    return { error: "You don't have permission to edit this project." };
  }

  return runProjectDetailAction({
    request,
    projectId: params.id,
    userId: auth.user.sub,
    core,
    form: await request.formData(),
  });
}

export default function ProjectDetail() {
  const {
    project,
    teams,
    upcomingMeetings,
    projectCalendar,
    recentActivity,
    epics,
    editableEpics,
    storyDependencies,
    epicDependencies,
    taskDependencies,
    timelineTerms,
    tasks,
    boardOptions,
    allDomainOptions,
    plannedTerms,
    pisByTerm,
    coreMembers,
    allTermOptions,
    chartStrings,
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
    infra,
  } = useLoaderData() as LoaderData;
  const actionData = useActionData<typeof action>();
  // The action's success returns vary by intent (some redirect, infra-config
  // returns { ok }), so narrow to the error-bearing shape for the page banner.
  const actionError = actionData && "error" in actionData ? actionData.error : undefined;
  const [scopeSettingsOpen, setScopeSettingsOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerNames = project.partners.map((p) => p.org.name);
  // Add ▸ Task on the timeline toolbar, and a story row's own Add task, open the
  // board's create form; the two are siblings under Progress, so the signal goes
  // up here and back down — carrying the epic/story it came from, if any.
  const [taskCreateSeed, setTaskCreateSeed] = useState<TaskCreateSeed | null>(null);
  // And the return leg: an epic the planning tab closed for a task form gets
  // put back once that form closes, saved or dismissed.
  const [epicReopen, setEpicReopen] = useState<{ epicId: string } | null>(null);

  // Per-epic term footprint, indexed for the planning list's term filter.
  const epicTermIds = useMemo(
    () => Object.fromEntries(boardOptions.epics.map((e) => [e.id, e.termIds])),
    [boardOptions.epics],
  );

  // Board people filter — narrows the task board to the chosen people. Lives in
  // the URL (?people=<id,id>) like the board's other filters, so a person-sliced
  // view is a link worth sending. Options are only people who hold tasks.
  const peopleOptions = useMemo(() => {
    const photoById = new Map(boardOptions.members.map((m) => [m.id, m.photoUrl]));
    const byId = new Map<string, string>();
    for (const t of tasks) for (const a of t.assignees) byId.set(a.id, a.name);
    return [...byId]
      .map(([id, name]) => ({ id, name, photoUrl: photoById.get(id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks, boardOptions.members]);
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
    const want = isOsTab(tabParam)
      ? tabParam
      : isTab(tabParam)
        ? LEGACY_TAB_TO_TAB[tabParam]
        : "progress";
    if (want === "mentorship" && !canViewMentorshipTab) return "progress";
    return want;
  };
  const tab = resolveTab();
  // A task bar on the planning timeline opens the task modal, which lives with
  // the board — its own tab classically, folded into Progress under os. Either
  // way this hops to it and sets ?task= in one go.
  const openTaskFromTimeline = (taskId: string) => {
    setSearchParams(
      (prev) => {
        prev.set("tab", "progress");
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
      epicDependencies={epicDependencies}
      taskDependencies={taskDependencies}
      timelineTerms={timelineTerms}
      // The same date-derived term set the board filters by, so a term that
      // only backdated work falls in is still pickable.
      terms={boardOptions.terms}
      // The list view's term filter reads the same per-epic term footprint the
      // board's does, rather than deriving a second one from the same dates.
      epicTermIds={epicTermIds}
      currentTermId={boardOptions.currentTermId}
      canEdit={canEdit}
      collabToken={collabToken}
      userName={userName}
      onTaskClick={openTaskFromTimeline}
      // Only on the os Progress tab, where the board is on this same surface
      // for the created task to appear in. A fresh object per add, so repeat
      // adds on the same story each reach the board.
      onAddTask={(link) =>
        setTaskCreateSeed({
          epicId: link?.epicId ?? null,
          storyId: link?.storyId ?? null,
          reopenEpicId: link?.reopenEpicId ?? null,
        })
      }
      reopenEpic={epicReopen}
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
      createSeed={taskCreateSeed}
      onCreateClosed={(seed) =>
        setEpicReopen(seed.reopenEpicId ? { epicId: seed.reopenEpicId } : null)
      }
      // The people filter lives on the board's own toolbar (os), beside search;
      // it only narrows the board's tasks.
      peopleOptions={peopleOptions}
      filterPeopleIds={selectedPeopleIds}
      onPeopleChange={setSelectedPeopleIds}
    />
  );

  const page = (
    // No column cap: this page fills the width its layout gutters give it, the
    // same as the task board and the partner/public views. The design's 1020px
    // figure was measured on a narrower shell than this one, and capping here
    // left every uncapped block on the page hanging past the right edge.
    <div className={cn("flex flex-col", "gap-6")}>
      <PresenceBar className="self-end" />

      {/* Overview header — always on top, not behind a tab */}
      <ProjectHeader
        project={project}
        partnerNames={partnerNames}
        canEdit={canEdit}
      />

      {/* Tab bar. Each section now owns its own edit button — there's no
          page-level edit mode left to clear when switching tabs. */}
      <OsTabBar
        ariaLabel="Project sections"
        tabs={OS_TABS.filter(
          (t) => t !== "mentorship" || canViewMentorshipTab,
        ).map((t) => ({ key: t, label: OS_TAB_LABELS[t] }))}
        active={tab as OsTab}
        onSelect={setTab}
        trailing={
          // Scope/challenge config lives behind this gear, visible only to
          // Core/Admin/Staff.
          canViewScope ? (
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
          ) : null
        }
      />

      {/* Page-level action errors — above the tab content so a failed save
          (e.g. the header form) is visible from any tab. The settings modal
          keeps its own inline copy. */}
      {actionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionError}
        </div>
      )}

      {(tab === "overview" || tab === "details") && (
        <OverviewTab
          // Under the os tabs the timeline is the Progress tab's own content,
          // so Project details renders without it.
          planning={null}
          showMeetings={false}
          project={project}
          teams={teams}
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
          pisByTerm={pisByTerm}
          coreMembers={coreMembers}
          currentTerm={currentTerm}
          chartStrings={chartStrings}
          allTermOptions={allTermOptions}
          infra={infra}
        />
      )}

      {/* Scope & challenges, now a settings popup gated to Core/Admin/Staff. */}
      {canViewScope && (
        <Modal
          open={scopeSettingsOpen}
          onClose={() => setScopeSettingsOpen(false)}
          labelledBy="scope-settings-title"
          containerClassName="bg-card rounded-os-card shadow-xl w-full max-w-4xl p-5 sm:p-5 my-auto max-h-[85vh] overflow-y-auto"
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
            actionError={actionError}
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
      <div className={cn("flex flex-col", "gap-6 min-h-[25vh]")}>
        {/* Progress (os): the timeline and the board are one surface — the plan
            above, the work under it — rather than two tabs you flip between to
            answer one question. */}
        {tab === "progress" && (
          // Wider than the page's own gap-6: the timeline and the board are two
          // surfaces sharing one tab, and at the page rhythm the board's
          // toolbar read as another row of the timeline card.
          <div className="flex flex-col gap-10">
            {planningNode}
            {board}
          </div>
        )}

        {/* Drive (os): the project's files and collab-doc pages in the shared
            DriveBrowser, embedded and scoped to this project. */}
        {tab === "drive" && (
          <ProjectDriveTab
            projectId={project.id}
            projectDriveScope={projectDriveScope}
            canEdit={canEdit}
            hasActivePartner={hasActivePartner}
            receiverViewer={{ isCore: canEditScope, isProjectMember: canEdit }}
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
type LoaderData = ProjectDetailData;

// Above this many terms the row collapses its middle so a long-running project
// doesn't push a wall of chips across the hero. Terms are chronological, so we
// keep the first and last few (the span endpoints) and hide the run between
// behind a "+N" that expands in place.
const TERMS_COLLAPSE_THRESHOLD = 8;
const TERMS_HEAD = 3;
const TERMS_TAIL = 3;

function TermChip({ code }: { code: string }) {
  return (
    <span className="rounded-os-item bg-os-container px-3 py-1 text-[13px] font-semibold text-foreground">
      {code}
    </span>
  );
}

function TermsChips({ terms }: { terms: { code: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = terms.length > TERMS_COLLAPSE_THRESHOLD;

  if (!collapsible || expanded) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {terms.map((t) => (
          <TermChip key={t.code} code={t.code} />
        ))}
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded-os-item px-2.5 py-1 text-[13px] font-medium text-os-grey transition-colors hover:text-foreground"
          >
            Show less
          </button>
        )}
      </div>
    );
  }

  const head = terms.slice(0, TERMS_HEAD);
  const tail = terms.slice(terms.length - TERMS_TAIL);
  const hidden = terms.length - TERMS_HEAD - TERMS_TAIL;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {head.map((t) => (
        <TermChip key={t.code} code={t.code} />
      ))}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Show ${hidden} more terms`}
        className="rounded-os-item bg-os-container/60 px-3 py-1 text-[13px] font-semibold text-os-grey transition-colors hover:bg-os-container hover:text-foreground"
      >
        +{hidden}
      </button>
      {tail.map((t) => (
        <TermChip key={t.code} code={t.code} />
      ))}
    </div>
  );
}

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
  // Name and icon each save the moment you change them — the hero has no edit
  // mode and no pencil (which used to collide with the taskboard's Edit-task
  // pencil). Only the name needs a transient draft while you type; icon
  // read/writes project state directly, so the field never drifts from the
  // loader. Status, terms and roles are read-only here now — they live in
  // Project settings (the gear), the one place that edits project scope.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);

  function startRename() {
    setNameDraft(project.name);
    setEditingName(true);
  }
  function commitName() {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!trimmed || trimmed === project.name) return;
    saveHeader({ name: trimmed });
  }
  // One write path for name + icon: post the current project values with the
  // one field being changed overridden, so a rename doesn't blank the icon and
  // vice versa. iconEmoji goes through "in patch" because null (no icon) is a
  // real value the ?? fallback would swallow. Status is edited in Project
  // settings now, but the `header` intent still validates it, so we carry the
  // current value through unchanged.
  function saveHeader(patch: {
    name?: string;
    iconEmoji?: string | null;
  }) {
    submit(
      {
        intent: "header",
        name: patch.name ?? project.name,
        status: project.status,
        iconEmoji: ("iconEmoji" in patch ? patch.iconEmoji : project.iconEmoji) ?? "",
      },
      { method: "post" },
    );
  }

  // Actual terms vs the expected span: when they differ, the label reads
  // "Terms · N of M" so a partially-scheduled project reads as such.
  // termCount is the expected target.
  const actualTermCount = project.actualTermCount;
  const termsClusterLabel =
    actualTermCount === project.termCount
      ? "Terms"
      : `Terms · ${actualTermCount} of ${project.termCount}`;

  // The design's right-hand clusters: a muted label over a row of plain chips,
  // the same dress for terms and roles. Read-only in the hero: terms and roles
  // are project scope, so Core edits them in Project settings (the gear), not
  // from the title row.
  const osTagGroup = (
    <div className="flex flex-wrap items-start gap-6">
      <HeroClusterLabel label={termsClusterLabel}>
        {project.terms.length === 0 ? (
          <span className="text-[13px] text-os-muted">No terms yet</span>
        ) : (
          <TermsChips terms={project.terms} />
        )}
      </HeroClusterLabel>

      <HeroClusterLabel label="Roles">
        {project.domains.length === 0 && project.derivedDomains.length === 0 ? (
          <span className="text-[13px] text-os-muted">No roles yet</span>
        ) : (
          // A role is a role: the set derived from bids and assignments (a
          // project staffed before anyone declared its domains) reads the same
          // as a declared one.
          <DomainChips
            items={project.domains.length > 0 ? project.domains : project.derivedDomains}
          />
        )}
      </HeroClusterLabel>

      {project.maintenancePlan && (
        <HeroClusterLabel label="Maintenance">
          <span className="rounded-full border border-os-accent/40 bg-os-accent/10 px-2.5 py-0.5 text-[13px] font-medium text-os-accent">
            {maintenanceLabel(project.maintenancePlan)}
          </span>
        </HeroClusterLabel>
      )}
    </div>
  );

  // Name, status and icon edit in place — no edit mode, no form wrapper. Each
  // control saves on its own (rename on blur/Enter, status and icon on change),
  // so the hero never swaps into a differently-shaped editor. A viewer who
  // can't edit gets the same three elements, read-only.
  const nameClasses = cn(
    "font-heading text-foreground",
    "text-[32px] font-medium",
  );
  const titleCluster = (
    <>
      {/* Real project icon at the title's own size — the design prints the
          emoji inline with the heading. The picker renders the same glyph and
          opens on click, so read and edit look identical until you click. */}
      {canEdit ? (
        <ProjectIconPicker
          iconEmoji={project.iconEmoji}
          editing
          onChange={(v) => saveHeader({ iconEmoji: v })}
        />
      ) : (
        <ProjectIcon iconEmoji={project.iconEmoji} size="inherit" />
      )}
      {canEdit && editingName ? (
        <input
          name="name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitName();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditingName(false);
            }
          }}
          aria-label="Project name"
          autoFocus
          // Sized to the name it holds so the title doesn't jump to a box of
          // some other width the moment you click it.
          style={{ width: `${Math.max(nameDraft.length, 8) + 1}ch` }}
          className={cn(
            nameClasses,
            "bg-transparent max-w-full focus:outline-none",
            "border-b border-os-container-hi focus:border-os-accent",
          )}
        />
      ) : (
        // Click-to-rename keeps the <h1> as the title element; when you can
        // edit it also acts as a button that turns into the field above.
        <h1
          className={cn(
            nameClasses,
            canEdit &&
              "cursor-text rounded-md -mx-1 px-1 transition-colors hover:bg-muted/40",
          )}
          role={canEdit ? "button" : undefined}
          tabIndex={canEdit ? 0 : undefined}
          title={canEdit ? "Rename project" : undefined}
          onClick={canEdit ? startRename : undefined}
          onKeyDown={
            canEdit
              ? (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    startRename();
                  }
                }
              : undefined
          }
        >
          {project.name}
        </h1>
      )}
    </>
  );

  return (
    <header className={cn("flex flex-col", "gap-6")}>
      <ProjectImageBanner
        projectId={project.id}
        projectName={project.name}
        initialPreviewUrl={project.imageUrlResolved}
        canEdit={canEdit}
        frameClassName="h-[275px] rounded-os-card"
      />
      <div className="min-w-0 flex-1">
        {/* The edit control is its own column at the far right, outside the
            row that wraps: while it rode along with the tag clusters it got
            pushed onto a line of its own under Roles as soon as they filled
            the row, and opening the editor re-flowed the clusters with it. */}
        <div className={cn("flex items-start justify-between", "gap-4")}>
          <div
            className={cn(
              "min-w-0 flex-1",
              "flex flex-wrap items-center justify-between gap-x-6 gap-y-4",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">{titleCluster}</div>
            </div>

            {/* os: the design's hero-meta row — title left, the term and role
                clusters right, both inside the wrapping column. */}
            {osTagGroup}
          </div>
        </div>
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
          // Edits on the same card the description reads on, in the design's
          // field dress — not a differently-shaped form dropped in its place.
          <Form
            method="post"
            ref={formRef}
            className={cn("flex flex-col gap-1.5", "rounded-os-card bg-os-container/40 os-form p-5")}
          >
            <input type="hidden" name="intent" value="description" />
            <textarea
              name="description"
              rows={6}
              defaultValue={description ?? ""}
              placeholder="Add a short description… (Markdown supported)"
              className="w-full resize-y"
              autoFocus
            />
          </Form>
        ) : (
          <div className="rounded-os-card bg-os-container/40 p-5">
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

// Status: the project's lifecycle plate (Active / Paused / Archived), edited
// here in Project settings so Core owns lifecycle changes in one place; the
// hero shows the same pill read-only.
function StatusSegment({
  status,
  canEdit,
}: {
  status: ProjectStatus;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Status"
      canEdit={canEdit}
      description="Active, Paused, or Archived — the lifecycle state shown as the pill beside the project name."
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          <Form method="post" ref={formRef} key={resetKey}>
            <input type="hidden" name="intent" value="status" />
            <Select
              name="status"
              defaultValue={status}
              ariaLabel="Project status"
              options={STATUSES.map((s) => ({ value: s, label: s }))}
              // The pill wears the current status's colour; the read view below
              // uses the same plate, so editing reads as the same badge.
              buttonClassName={cn(
                "rounded-full border transition-[filter] hover:brightness-95",
                cn("px-3 py-[5px] text-xs font-semibold", STATUS_PILL_OS[status]),
              )}
            />
          </Form>
        ) : (
          <StatusBadge status={status} />
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

// Meeting recording toggle (specs/meeting-transcription.md). Core-only
// (listed in SCOPE_INTENTS); Disabled hides the Record button and all three
// "record this meeting?" prompts for this project's meetings.
function RecordingPolicySegment({
  recordingPolicy,
  canEdit,
}: {
  recordingPolicy: "Allowed" | "Disabled";
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const allowed = recordingPolicy !== "Disabled";

  return (
    <EditableSection
      title="Meeting recording"
      canEdit={canEdit}
      description="Lets anyone editing a meeting note on this project record it. Audio is transcribed, then deleted after."
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          <Form method="post" ref={formRef} key={resetKey}>
            <input type="hidden" name="intent" value="recordingPolicy" />
            <Toggle
              name="recordingAllowed"
              defaultChecked={allowed}
              label="Allow recording this project's meetings"
            />
          </Form>
        ) : (
          <p className="text-sm text-foreground">
            {allowed ? "Allowed" : "Disabled"}
            <span className="block text-xs text-muted-foreground">
              {allowed
                ? "The Record button and record prompts are available on this project's meeting notes."
                : "The Record button and record prompts are hidden for this project's meetings."}
            </span>
          </p>
        )
      }
    </EditableSection>
  );
}

// Read-only (specs/meeting-notes-model.md §1): the picker lives on the
// template page itself, in the Drive templates gallery — this just shows
// what's bound so Settings isn't the one place that's silent about it.
function MeetingNoteTemplateSegment({
  meetingNoteTemplate,
}: {
  meetingNoteTemplate: { id: string; title: string } | null;
}) {
  return (
    <EditableSection title="Meeting note template" canEdit={false}>
      {() => (
        <p className="text-sm text-foreground">
          {meetingNoteTemplate ? (
            <Link to={`/documents/${meetingNoteTemplate.id}`} className="text-os-accent hover:underline">
              {meetingNoteTemplate.title}
            </Link>
          ) : (
            "None"
          )}
          <span className="block text-xs text-muted-foreground">
            Seeds every new meeting note for this project. Set from a template page's own ⋯ menu
            ("Use for this project's meeting notes").
          </span>
        </p>
      )}
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
                  ? "bg-os-accent/15 border-os-accent/40 text-foreground"
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
                  ? "bg-os-accent/15 border-os-accent/40 text-foreground"
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
  // figma.com/{file|design}/{key}/{name} — show the readable name segment, with
  // dashes turned back into spaces; fall back to "Figma" for a bare file URL.
  const figmaName = (url: string) => {
    try {
      const name = new URL(url).pathname.split("/").filter(Boolean)[2];
      return name ? decodeURIComponent(name).replace(/-/g, " ") : "Figma";
    } catch {
      return "Figma";
    }
  };
  const dash = <span className="text-os-muted">—</span>;
  const ic = OS_DETAIL_ICON;

  return (
    <div className={OS_DETAIL_CARD}>
      <DetailRow icon={<Mail className={ic} />} label="Calendar email">
        {project.calendarEmail ? (
          <a
            href={`mailto:${project.calendarEmail}`}
            className="text-os-accent hover:underline break-all"
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
            className="inline-flex items-center gap-1 text-os-accent hover:underline"
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
                className="rounded-full bg-os-container px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:text-os-accent"
              >
                {repoName(url)}
              </a>
            ))}
          </div>
        ) : (
          dash
        )}
      </DetailRow>

      <DetailRow icon={<Figma className={ic} />} label="Figma">
        {project.figmaUrls.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {project.figmaUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-os-container px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:text-os-accent"
              >
                {figmaName(url)}
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
            className="inline-flex items-center gap-1 text-os-accent hover:underline break-all"
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
                  className="text-os-accent hover:underline break-all"
                >
                  {project.teamGroupEmail}
                </a>
              </DetailRow>
            )}
            <DetailRow icon={<CalendarDays className={ic} />} label="Terms required">
              {project.termCount} {project.termCount === 1 ? "term" : "terms"}
            </DetailRow>
          </div>
        )}
      </div>
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
  const ic = OS_DETAIL_ICON;
  const field = "w-full";

  return (
    <div className={OS_DETAIL_CARD}>
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
        infoTip={<InfoTip content="One URL per line" />}
      >
        <textarea
          name="repoUrls"
          rows={3}
          defaultValue={project.repoUrls.join("\n")}
          placeholder="https://github.com/dali-lab/…"
          className={cn(field, "resize-y font-mono")}
        />
      </DetailEditRow>

      <DetailEditRow
        icon={<Figma className={ic} />}
        label="Figma"
        infoTip={<InfoTip content="One URL per line" />}
      >
        <textarea
          name="figmaUrls"
          rows={3}
          defaultValue={project.figmaUrls.join("\n")}
          placeholder="https://figma.com/design/…"
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
        infoTip={<InfoTip content="The planned span, not the terms staffed so far" />}
      >
        <input
          name="termCount"
          type="number"
          min={1}
          defaultValue={project.termCount}
          className={field}
        />
      </DetailEditRow>

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

  return (
    <EditableSection
      title="Project details"
      icon={<Info className="w-4 h-4" />}
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) =>
        editing ? (
          <Form method="post" ref={formRef} className="os-form w-full">
            <input type="hidden" name="intent" value="details" />
            <DetailsEditOs project={project} canEditFinance={canEditFinance} />
          </Form>
        ) : (
          <DetailsReadOs project={project} canEditFinance={canEditFinance} />
        )
      }
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
                            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/30 resize-y"
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


function StatusBadge({
  status,
}: {
  status: (typeof STATUSES)[number];
}) {
  // The design's status tag — the same plate the project cards wear over their
  // cover, so a project reads the same in the grid and on its own page.
  return (
    <span
      className={`rounded-full border px-3 py-[5px] text-xs font-semibold ${STATUS_PILL_OS[status]}`}
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
}: {
  team: LoaderData["teams"][number];
  canEdit: boolean;
  currentTermCode: string | null;
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
      {/* The design's member cards: avatar, name, and the role as plain text.
          The level itself is not shown — P1/P2/P3 is an internal ladder, and
          the only part of it this page needs to say is who mentors each
          domain, which is the domain's P3. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {team.members.map((m) => (
          <div
            key={m.assignmentId}
            className="flex items-center gap-3 rounded-os-item bg-os-container/40 p-3"
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
    </div>
  );
}

function PrincipalInvestigatorsSection({
  plannedTerms,
  pisByTerm,
  coreMembers,
  canEdit,
  currentTermId,
}: {
  plannedTerms: LoaderData["plannedTerms"];
  pisByTerm: LoaderData["pisByTerm"];
  coreMembers: LoaderData["coreMembers"];
  canEdit: boolean;
  currentTermId: string | null;
}) {
  const submit = useSubmit();
  const { sectionTitle } = useOsChrome();
  if (plannedTerms.length === 0) return null;
  const upcoming = currentTermId
    ? plannedTerms.filter((t) => {
        const current = plannedTerms.find((p) => p.id === currentTermId);
        return !current || t.sortKey >= current.sortKey;
      })
    : plannedTerms;
  const rows = upcoming.length > 0 ? upcoming : plannedTerms.slice(0, 1);
  return (
    <div className="flex flex-col gap-2">
      <h2 className={sectionTitle}>
        Principal Investigators
      </h2>
      <div className="flex flex-col gap-2 rounded-os-card bg-os-container/40 p-3">
        {rows.map((t) => {
          const pi = pisByTerm[t.id] ?? null;
          const isCurrent = currentTermId !== null && t.id === currentTermId;
          const options = [
            { value: "", label: "No PI" },
            ...(pi && !coreMembers.some((m) => m.userId === pi.userId)
              ? [{ value: pi.userId, label: pi.name }]
              : []),
            ...coreMembers.map((m) => ({ value: m.userId, label: m.name })),
          ];
          return (
            <div
              key={t.id}
              className="grid grid-cols-[minmax(80px,120px)_minmax(0,1fr)] items-center gap-3"
            >
              <div className="text-xs font-medium text-muted-foreground">
                {t.code}
                {isCurrent && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-accent-teal/40 bg-accent-teal/15 text-accent-teal">
                    Current
                  </span>
                )}
              </div>
              {canEdit ? (
                <Select
                  ariaLabel={`PI for ${t.code}`}
                  value={pi?.userId ?? ""}
                  onChange={(v) => {
                    const form = new FormData();
                    form.set("intent", "pi");
                    form.set("termId", t.id);
                    form.set("piUserId", v);
                    submit(form, { method: "post" });
                  }}
                  options={options}
                />
              ) : (
                <div className="text-sm text-foreground">
                  {pi?.name ?? <span className="italic text-muted-foreground">No PI</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
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
  const { sectionTitle } = useOsChrome();
  // teams is pre-sorted newest term first by the loader, so the head is the
  // roster the page is about and the tail is history.
  const [currentTeam, ...previousTeams] = teams;

  return (
    <div className="flex flex-col gap-2">
      <h2 className={sectionTitle}>
        Team
      </h2>
      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No team assignments yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <TeamTermGroup
            team={currentTeam}
            canEdit={canEdit}
            currentTermCode={currentTermCode}
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
                className="flex w-full items-center gap-2 rounded-os-item bg-os-container/40 px-3 py-2.5 text-left text-sm font-semibold text-os-grey transition-colors hover:text-foreground"
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
            <span className="truncate font-medium text-foreground group-hover:text-os-accent">
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
        className="flex w-full items-center gap-1.5 text-left text-[15px] font-semibold text-foreground transition-colors hover:text-os-accent"
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
  upcomingMeetings,
  showMeetings = true,
  recentActivity,
  canEdit,
  canEditFinance,
  canEditAssignmentLevel,
  canManagePartners,
  hasActivePartner,
  linkablePartnerOrgs,
  domainScopeGrid,
  plannedTerms,
  pisByTerm,
  coreMembers,
  currentTerm,
  chartStrings,
  allTermOptions,
  infra,
}: {
  // The epics & sprints timeline, rendered at the top of the body. Passed in
  // as an element so Overview doesn't have to re-declare all of Planning's
  // props just to forward them.
  planning: ReactNode;
  project: LoaderData["project"];
  teams: LoaderData["teams"];
  upcomingMeetings: LoaderData["upcomingMeetings"];
  // False under the os tab set, where meetings ride the Progress timeline.
  showMeetings?: boolean;
  recentActivity: LoaderData["recentActivity"];
  canEdit: boolean;
  canEditFinance: boolean;
  canEditAssignmentLevel: boolean;
  canManagePartners: boolean;
  hasActivePartner: boolean;
  linkablePartnerOrgs: LoaderData["linkablePartnerOrgs"];
  domainScopeGrid: LoaderData["domainScopeGrid"];
  plannedTerms: LoaderData["plannedTerms"];
  pisByTerm: LoaderData["pisByTerm"];
  coreMembers: LoaderData["coreMembers"];
  currentTerm: LoaderData["currentTerm"];
  chartStrings: LoaderData["chartStrings"];
  allTermOptions: LoaderData["allTermOptions"];
  infra: LoaderData["infra"];
}) {
  const [showFutureChallenges, setShowFutureChallenges] = useState(false);
  const tz = useUserTimeZone();
  // Under dali.os a section is a title over its content, not a box around it —
  // so the cards these sections hold stop showing a second border inside a first.
  const { sectionShell, sectionTitle } = useOsChrome();

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
              <h3 className={sectionTitle}>
                Challenge{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  · {currentTerm.code}
                </span>
              </h3>
              {futureChallengeGroups.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFutureChallenges((v) => !v)}
                  className="text-xs font-medium text-os-accent hover:underline"
                >
                  {showFutureChallenges
                    ? "Hide upcoming terms"
                    : `Upcoming terms (${futureChallengeGroups.length})`}
                </button>
              )}
            </div>
            {/* The body takes the surface under os; the section around it is
                only a title, so this is the one card here. */}
            <div className="rounded-os-card bg-os-container/40 p-4">
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

      {/* Payroll chart strings. Core-only, and its own section rather than a
          row inside Project details: that section commits as one
          full-replacement form, while each chart string is an append that
          supersedes its predecessor. It also carries its own fetcher.Form,
          which cannot nest inside the details Form. */}
      {canEditFinance && (
        <EditableSection
          title="Payroll chart strings"
          icon={<Info className="w-4 h-4" />}
          canEdit={false}
        >
          {() => (
            <ChartStringPanel
              chartStrings={chartStrings}
              termOptions={allTermOptions}
              currentTermId={currentTerm?.id ?? null}
            />
          )}
        </EditableSection>
      )}

      {/* Cloud infrastructure (Fly + Neon): read-only inventory/usage for any
          member; config + change-requests for staffed (core||isProjectMember).
          Wears the shared EditableSection primitive (own section shell). */}
      <ProjectInfraSection
        projectId={project.id}
        canEdit={canEdit}
        config={infra.config}
        view={infra.view}
        requests={infra.requests}
        knownOrgs={infra.knownOrgs}
        setupErrors={infra.setupErrors}
      />

      {/* Principal Investigators — the Core member in charge of this project
          per term. Core (canEditFinance, mirroring the renewals surface) can
          reassign; everyone else sees a read-only roster. */}
      <section className={sectionShell}>
        <PrincipalInvestigatorsSection
          plannedTerms={plannedTerms}
          pisByTerm={pisByTerm}
          coreMembers={coreMembers}
          canEdit={canEditFinance}
          currentTermId={currentTerm?.id ?? null}
        />
      </section>

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

      {/* Recent project-scoped audit activity — editors only (the loader
          returns an empty list otherwise). Read-only. */}
      {canEdit && recentActivity.length > 0 && (
        <section className={sectionShell}>
          <h2 className={sectionTitle}>
            Recent activity
          </h2>
          <ul className={cn("flex flex-col gap-2", "rounded-os-card bg-os-container/40 p-4")}>
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
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/30"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground pb-2">
          <input type="checkbox" name="includeOverviewPage" className="accent-os-accent" />
          Include Overview page
        </label>
        <Button type="submit" size="sm">
          Save template
        </Button>
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
      tone: "destructive",
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

      <StatusSegment status={project.status} canEdit={canEdit} />

      <VisibilitySegment isPrivate={project.isPrivate} canEdit={canEdit} />

      <RecordingPolicySegment recordingPolicy={project.recordingPolicy} canEdit={canEdit} />

      <MeetingNoteTemplateSegment meetingNoteTemplate={project.meetingNoteTemplate} />

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
            <Link role="menuitem" to={`/core/partners/orgs/${orgId}`} className={itemClass} onClick={() => setOpen(false)}>
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
    <div className={OS_DETAIL_CARD}>
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
                    to={`/core/partners/orgs/${p.org.id}`}
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
  const { sectionShell, sectionTitle } = useOsChrome();

  return (
    <section className={sectionShell}>
      <div className="flex items-center justify-between">
        <h2 className={sectionTitle}>
          Partners
        </h2>
        {canManage && linkablePartnerOrgs.length > 0 && (
          <button
            type="button"
            onClick={() => setLinking((v) => !v)}
            className="text-xs font-medium text-os-accent hover:underline"
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
            className="h-9 rounded-lg bg-os-accent text-os-bg text-sm font-medium px-4 hover:opacity-90 transition"
          >
            Link
          </button>
        </Form>
      )}

      <PartnersContactsOs
        partners={partners}
        canManage={canManage}
        tz={tz}
        confirmSubmit={confirmSubmit}
      />
    </section>
  );
}

// ── ProjectDriveTab ──────────────────────────────────────────────────────────
// Renders the shared DriveBrowser locked to this project's scope.

// Project drives hold docs, folders and files. Folders are always shown (the
// browser never filters them out), so the filter only needs the leaf kinds.
type ProjectDriveTypeFilter = Extract<DriveTypeFilter, "all" | "doc" | "notebook" | "whiteboard" | "slides" | "file">;
const PROJECT_TYPE_FILTERS: { value: ProjectDriveTypeFilter; label: string; icon?: ReactNode }[] = [
  { value: "all", label: "All types" },
  { value: "doc", label: "Documents", icon: <FileText className="w-3.5 h-3.5" /> },
  { value: "notebook", label: "Notebooks", icon: <NotebookPen className="w-3.5 h-3.5" /> },
  { value: "whiteboard", label: "Whiteboards", icon: <Shapes className="w-3.5 h-3.5" /> },
  { value: "slides", label: "Slide decks", icon: <Presentation className="w-3.5 h-3.5" /> },
  { value: "file", label: "Files", icon: <Paperclip className="w-3.5 h-3.5" /> },
];

// Ids of a folder plus everything under it — a folder can't be moved into its
// own subtree, so these are disabled in the move picker.
function folderSubtree(items: DriveItem[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const it of items) {
    if (!it.parentFolderId) continue;
    const arr = childrenOf.get(it.parentFolderId) ?? [];
    arr.push(it.id);
    childrenOf.set(it.parentFolderId, arr);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenOf.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

function ProjectDriveTab({
  projectId,
  projectDriveScope,
  canEdit,
  hasActivePartner,
  receiverViewer,
}: {
  projectId: string;
  projectDriveScope: DriveTreeScope;
  canEdit: boolean;
  hasActivePartner: boolean;
  receiverViewer?: { isCore: boolean; isProjectMember: boolean };
}) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<ProjectDriveTypeFilter>("all");
  const scopeId = projectDriveScope.id;
  const revalidate = useCallback(() => revalidator.revalidate(), [revalidator]);
  const history = useDriveHistory({ onChange: revalidate });
  useDriveHistoryKeys(history);
  const pendingHidden = usePendingHidden(revalidator.state, projectDriveScope);
  const visibleScopes = useMemo(
    () => withoutHidden([projectDriveScope], pendingHidden.ids),
    [projectDriveScope, pendingHidden.ids],
  );

  // Upload into the current project folder via the shared presign→register flow
  // (identical path to the main Drive hub — see useDriveFileUpload).
  const uploadTarget = useMemo(
    () => ({ scope: { kind: "Project" as const, projectId }, folderPageId: currentFolderId }),
    [projectId, currentFolderId],
  );
  const { inputRef, uploading, uploadError, handleFileChange, uploadFiles } = useDriveFileUpload(
    uploadTarget,
    revalidate,
  );

  // Move-destination picker (single project scope). pickMoveDestination opens it
  // and resolves with the chosen Destination (or null on cancel).
  const [movePicker, setMovePicker] = useState<{
    heading: string;
    drives: PickerDrive[];
    folders: PickerFolder[];
    disabledFolderIds?: Set<string>;
    disabledDest?: Destination;
    initial?: Destination;
  } | null>(null);
  const movePickerResolve = useRef<((d: Destination | null) => void) | null>(null);
  const resolveMovePicker = useCallback((d: Destination | null) => {
    setMovePicker(null);
    movePickerResolve.current?.(d);
    movePickerResolve.current = null;
  }, []);

  // Sync doc-title changes made in the split-pane editor back to this listing.
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

  // Toggle partner visibility for a page (doc/folder). Posts to the
  // partner-visibility endpoint, then revalidates so the badge updates.
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

  const onOpenBeside = useOpenBeside();
  const onOpenItem = useCallback(
    (item: DriveItem) => {
      if (!item.href) return;
      if (item.type === "doc") onOpenBeside({ href: item.href });
      else navigate(item.href);
    },
    [navigate, onOpenBeside],
  );

  // One item's move, with no reporting: the batch below speaks for the
  // selection. `onError` gets the reason a move was refused.
  const moveOne = useCallback(
    async (item: DriveItem, destFolderId: string | null, onError?: (message: string) => void): Promise<boolean> => {
      // Both endpoints (and what each calls its destination field) live in
      // move-item.ts, shared with the Drive hub — this embed had its own copy
      // and it drifted out of step with the pages endpoint's schema.
      try {
        const res = await moveDriveItem(item, destFolderId);
        if (res.ok) return true;
        onError?.((await driveErrorFrom(res)) ?? "Couldn't move");
        return false;
      } catch {
        onError?.("Couldn't move");
        return false;
      }
    },
    [],
  );

  // Move a selection into a folder (null = the project's top level): hide the
  // rows, move them one by one, then revalidate and report once.
  const moveItems = useCallback(
    async (items: DriveItem[], destFolderId: string | null) => {
      let failure: string | undefined;
      const landed = await runHiddenMoveBatch(
        items,
        (item) =>
          moveOne(item, destFolderId, (message) => {
            failure ??= message;
          }),
        pendingHidden,
      );
      reportMoveBatch(
        { toast, history, revalidate },
        {
          landed,
          total: items.length,
          destination: destinationLabel(projectDriveScope, destFolderId),
          forward: (l) => moveOne(l.item, destFolderId),
          back: (l) => moveOne({ ...l.item, parentFolderId: destFolderId }, l.folderId),
          failure: items.length === 1 ? failure : undefined,
        },
      );
    },
    [moveOne, pendingHidden, toast, history, revalidate, projectDriveScope],
  );

  // Dropping a selection onto a folder. Dragging one row of a multi-selection
  // brings the whole selection, so this takes a list.
  const onMove = useCallback(
    (_scopeId: string, items: DriveItem[], destFolderId: string | null) => moveItems(items, destFolderId),
    [moveItems],
  );

  // Open the destination picker over this project's folders and resolve with the
  // chosen destination (or null on cancel).
  const pickMoveDestination = useCallback(
    (item: DriveItem, heading: string): Promise<Destination | null> => {
      const rootId = projectDriveScope.rootFolderId ?? null;
      const drives: PickerDrive[] = [
        {
          id: scopeId,
          label: projectDriveScope.label,
          iconEmoji: projectDriveScope.iconEmoji,
          audience: projectDriveScope.scopeAudience ?? null,
        },
      ];
      // One pass gives every folder its child count, so a row can say what's
      // inside it rather than only its name.
      const childCount = new Map<string, number>();
      for (const it of projectDriveScope.items) {
        if (it.parentFolderId === null) continue;
        childCount.set(it.parentFolderId, (childCount.get(it.parentFolderId) ?? 0) + 1);
      }
      const folders: PickerFolder[] = projectDriveScope.items
        .filter((f) => f.type === "folder")
        .map((f) => ({
          id: f.id,
          driveId: scopeId,
          parentId: (f.parentFolderId ?? null) === rootId ? null : f.parentFolderId,
          title: f.title,
          iconEmoji: f.iconEmoji,
          itemCount: childCount.get(f.id) ?? 0,
        }));
      const banned = item.type === "folder" ? folderSubtree(projectDriveScope.items, item.id) : undefined;
      const currentFolder = (item.parentFolderId ?? null) === rootId ? null : (item.parentFolderId ?? null);
      const currentDest: Destination = { driveId: scopeId, folderId: currentFolder };
      return new Promise<Destination | null>((resolve) => {
        movePickerResolve.current = resolve;
        setMovePicker({
          heading,
          drives,
          folders,
          disabledFolderIds: banned,
          disabledDest: currentDest,
          initial: currentDest,
        });
      });
    },
    [scopeId, projectDriveScope, resolveMovePicker],
  );

  const getScopeActions = useCallback(
    (_scopeId: string): RowActions => ({
      onRename: async (item) => {
        const next = await dialog.prompt({
          title: "Rename",
          label: "Name",
          defaultValue: item.title || "",
          confirmLabel: "Save",
          validate: (v) => (v.trim() ? null : "Enter a name"),
        });
        if (next === null) return;
        const title = next.trim();
        if (title === item.title) return;
        const isFile = item.type === "file";
        const res = isFile
          ? await fetch(`/api/files/${item.id}`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intent: "rename", title }),
            })
          : await fetch(`/api/documents/${item.id}`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            });
        if (res.ok) revalidate();
        else toast.error("Couldn't rename");
      },
      onRequestMove: async (item) => {
        const dest = await pickMoveDestination(item, `Move "${item.title || "Untitled"}"`);
        if (dest) await onMove(scopeId, [item], dest.folderId);
      },
      onDelete: async (item) => {
        const ok = await dialog.confirm({
          title: `Delete "${item.title || "this item"}"?`,
          description:
            item.type === "folder"
              ? "The folder must be empty first."
              : "This moves it to the trash.",
          tone: "destructive",
          confirmLabel: "Delete",
        });
        if (!ok) return;
        await runTrash({ items: [item], deleteOne: deleteDriveItemRequest, hiding: pendingHidden, history, toast, revalidate });
      },
    }),
    [dialog, toast, revalidate, pickMoveDestination, onMove, scopeId, pendingHidden, history],
  );

  const onToggleFavorite = useCallback(
    async (item: DriveItem) => {
      if (item.type !== "doc" && item.type !== "folder") return;
      await setPageFavorite(item.id, !item.favorited);
      revalidate();
    },
    [revalidate],
  );

  // Create a doc/folder into the current project folder (or the project root).
  const createPage = useCallback(
    async (kind: "FreeForm" | "Folder", title: string): Promise<string | null> => {
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind, ...(currentFolderId ? { parentPageId: currentFolderId } : {}) }),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { id: string }).id;
    },
    [projectId, currentFolderId],
  );

  const createDoc = useCallback(async () => {
    const name = await dialog.prompt({
      title: "New document",
      label: "Name",
      defaultValue: "Untitled",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const id = await createPage("FreeForm", name.trim());
    if (id) navigate(`/documents/${id}`);
    else toast.error("Couldn't create the document");
  }, [dialog, createPage, navigate, toast]);

  const createFolder = useCallback(async () => {
    const name = await dialog.prompt({
      title: "New folder",
      label: "Folder name",
      defaultValue: "New folder",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const id = await createPage("Folder", name.trim());
    if (id) {
      toast.success("Folder created");
      revalidate();
    } else {
      toast.error("Couldn't create the folder");
    }
  }, [dialog, createPage, revalidate, toast]);

  function deleteDriveItemRequest(item: DriveItem): Promise<Response> {
    const endpoint = item.type === "file" ? `/api/files/${item.id}` : `/api/documents/${item.id}`;
    return fetch(endpoint, { method: "DELETE", credentials: "include" });
  }

  const onBulkDelete = useCallback(
    async (items: DriveItem[]) => {
      if (items.length === 0) return;
      const ok = await dialog.confirm({
        title: `Delete ${items.length} item${items.length === 1 ? "" : "s"}?`,
        description: "Folders must be empty first.",
        tone: "destructive",
        confirmLabel: "Delete",
      });
      if (!ok) return;
      await runTrash({ items, deleteOne: deleteDriveItemRequest, hiding: pendingHidden, history, toast, revalidate });
    },
    [dialog, toast, revalidate, pendingHidden, history],
  );

  const onBulkMove = useCallback(
    async (items: DriveItem[]) => {
      const movable = items.filter((i) => i.type === "doc" || i.type === "folder" || i.type === "file");
      if (movable.length === 0) return;
      const dest = await pickMoveDestination(movable[0], `Move ${itemCount(movable.length)}`);
      if (dest) await moveItems(movable, dest.folderId);
    },
    [pickMoveDestination, moveItems],
  );

  const filterControl = (
    <div data-testid="drive-filter">
      <Select<ProjectDriveTypeFilter>
        value={typeFilter}
        onChange={setTypeFilter}
        ariaLabel="Filter by type"
        align="right"
        options={PROJECT_TYPE_FILTERS.map((f) => ({ value: f.value, label: f.label, icon: f.icon }))}
        buttonClassName={cn(filterPillClass(), "w-full sm:w-40")}
      />
    </div>
  );

  // The same New control the unified Drive wears — this tab is the same
  // browser, and a different button here read as a different app's control
  // sitting in Drive's toolbar. Without edit rights it greys out in place
  // rather than leaving a hole for the controls beside it to slide into.
  const newMenu = !canEdit ? (
    <button
      type="button"
      disabled
      data-testid={`drive-new-menu-${scopeId}-disabled`}
      title="You don't have edit access to this project"
      className={cn(DRIVE_TOOLBAR_BTN, "cursor-not-allowed opacity-40")}
    >
      <Plus className="h-[18px] w-[18px]" strokeWidth={1.5} /> New
      <ChevronDown className="w-3.5 h-3.5 opacity-80" />
    </button>
  ) : (
    <Menu
      align="right"
      ariaLabel="New in this project"
      trigger={
        <button
          type="button"
          data-testid={`drive-new-menu-${scopeId}`}
          className={DRIVE_TOOLBAR_BTN}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={1.5} /> New
          <ChevronDown className="w-3.5 h-3.5 opacity-80" />
        </button>
      }
    >
      <Menu.Item icon={<FileText className="w-3.5 h-3.5" />} onSelect={() => void createDoc()}>
        <span data-testid={`drive-new-doc-${scopeId}`}>New document</span>
      </Menu.Item>
      <Menu.Item icon={<FolderPlus className="w-3.5 h-3.5" />} onSelect={() => void createFolder()}>
        <span data-testid={`drive-new-folder-${scopeId}`}>New folder</span>
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item icon={<Upload className="w-3.5 h-3.5" />} disabled={uploading} onSelect={() => inputRef.current?.click()}>
        <span data-testid={`drive-new-upload-${scopeId}`}>{uploading ? "Uploading…" : "Upload files"}</span>
      </Menu.Item>
    </Menu>
  );

  return (
    <DriveHistoryContext.Provider value={history}>
      {uploadError && (
        <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-sm text-destructive">
          {uploadError}
        </div>
      )}
      <DriveBrowser
        scopes={visibleScopes}
        currentScopeId={scopeId}
        currentFolderId={currentFolderId}
        typeFilter={typeFilter}
        search={search}
        onSearchChange={setSearch}
        onNavigate={onNavigate}
        onOpenItem={onOpenItem}
        onOpenBeside={onOpenBeside}
        onMove={onMove}
        getScopeActions={getScopeActions}
        onToggleFavorite={onToggleFavorite}
        onBulkDelete={canEdit ? onBulkDelete : undefined}
        onBulkMove={canEdit ? onBulkMove : undefined}
        onUploadFiles={
          canEdit
            ? (files, opts) =>
                void uploadFiles(files, { folderPageId: opts?.folderId, skippedFolders: opts?.skippedFolders })
            : undefined
        }
        filterControl={filterControl}
        newMenu={newMenu}
        embeddedScopeId={scopeId}
        onTogglePartnerVisible={canEdit ? togglePagePartnerVisible : undefined}
        hasActivePartner={hasActivePartner}
        receiverViewer={receiverViewer}
      />
      <DriveUploadInput
        inputRef={inputRef}
        onChange={handleFileChange}
        testId={`drive-upload-input-${scopeId}`}
      />
      {movePicker && (
        <FolderPicker
          open
          heading={movePicker.heading}
          drives={movePicker.drives}
          folders={movePicker.folders}
          disabledFolderIds={movePicker.disabledFolderIds}
          disabledDest={movePicker.disabledDest}
          initial={movePicker.initial}
          onClose={() => resolveMovePicker(null)}
          onConfirm={(dest) => resolveMovePicker(dest)}
        />
      )}
    </DriveHistoryContext.Provider>
  );
}

// Planning holds the epics & sprints manager, rendered as the Gantt timeline
// at the top of Overview.
function PlanningTab({
  projectId,
  epics,
  editableEpics,
  storyDependencies,
  epicDependencies,
  taskDependencies,
  timelineTerms,
  terms,
  epicTermIds,
  currentTermId,
  canEdit,
  collabToken,
  userName,
  onTaskClick,
  onAddTask,
  reopenEpic,
}: {
  projectId: string;
  epics: TimelineEpic[];
  editableEpics: EditableEpic[];
  storyDependencies: StoryDependencyEdge[];
  epicDependencies: EpicDependencyEdge[];
  taskDependencies: TaskDependencyEdge[];
  timelineTerms: TimelineTerm[];
  terms: { id: string; code: string }[];
  epicTermIds: Record<string, string[]>;
  currentTermId: string | null;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
  onTaskClick: (taskId: string) => void;
  onAddTask?: (link?: {
    epicId: string;
    storyId: string;
    reopenEpicId?: string;
  }) => void;
  reopenEpic?: { epicId: string } | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <EpicSprintManager
        projectId={projectId}
        epics={editableEpics}
        terms={terms}
        canManage={canEdit}
        collabToken={collabToken}
        userName={userName}
        timelineEpics={epics}
        storyDependencies={storyDependencies}
        epicDependencies={epicDependencies}
        taskDependencies={taskDependencies}
        timelineTerms={timelineTerms}
        epicTermIds={epicTermIds}
        currentTermId={currentTermId}
        onTaskClick={onTaskClick}
        onAddTask={onAddTask}
        reopenEpic={reopenEpic}
      />
    </div>
  );
}

// Same look as ViewToggle's buttons (the hub's list/cards switch) — that
// component is hardwired to list/card values, so the planning toggle borrows
// its styling rather than its state.

