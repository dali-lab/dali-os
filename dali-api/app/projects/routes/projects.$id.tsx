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
  useNavigate,
  useRevalidator,
  useSearchParams,
  useSubmit,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { Select, Menu } from "~/components/ui/floating";
import {
  CalendarDays,
  Settings,
  Folder,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  FileText,
  Info,
  Paperclip,
  Plus,
  Upload,
  NotebookPen,
  Presentation,
  Shapes,
} from "lucide-react";
import type { DriveTypeFilter } from "~/components/drive/type-filter";
import { useOsChrome } from "~/components/os-chrome";
import { setPageFavorite } from "~/components/favorites-live";
import { ChartStringPanel } from "~/projects/components/ChartStringPanel";
import { OsTabBar } from "~/components/os-page";
import { cn } from "~/lib/cn";
import { Modal, ModalHeader } from "~/components/Modal";
import { useDialog } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import { EditableSection } from "~/components/EditableSection";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import type { Route } from "./+types/projects.$id";
import { MonthCalendarPanel } from "~/components/MonthCalendarPanel";
import { ProjectInfraSection } from "~/projects/components/ProjectInfraSection";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { Avatar } from "~/components/ui/Avatar";
import { ProjectViewSwitch } from "../components/ProjectViewSwitch";
import { ProjectIcon } from "~/components/ProjectIcon";
import { isCore, isProjectMember, currentTerm } from "~/lib/roles";
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
import { type ProjectStatus } from "../lib/project-lifecycle";
import { loadProjectDetail } from "../lib/project-detail.server";
import { runProjectDetailAction } from "../lib/project-detail-actions.server";
import {
  ACTIVITY_LABELS,
  OS_TABS,
  OS_TAB_LABELS,
  STATUS_PILL_OS,
  isOsTab,
  isTab,
  relativeTime,
  type OsTab,
  type Tab,
} from "~/projects/components/detail/constants";
import { type LoaderData } from "~/projects/components/detail/types";
import { ProjectHeader } from "~/projects/components/detail/ProjectHeader";
import { DescriptionSegment, DetailsSegment } from "~/projects/components/detail/DetailsSegments";
import { DeleteProjectSection, SaveAsTemplateSection, ScopeTab } from "~/projects/components/detail/ProjectSettings";
import { PartnersSection } from "~/projects/components/detail/PartnersSection";

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

export default function ProjectDetail({ loaderData }: Route.ComponentProps) {
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
  } = loaderData;
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

function StatusBadge({
  status,
}: {
  status: ProjectStatus;
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

