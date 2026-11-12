import { useCallback, useMemo, useState } from "react";
import {
  redirect,
  useActionData,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { Settings } from "lucide-react";
import { OsTabBar } from "~/components/os-page";
import { cn } from "~/lib/cn";
import { Modal, ModalHeader } from "~/components/Modal";
import { Tooltip } from "~/components/ui/floating";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import type { Route } from "./+types/projects.$id";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { ProjectViewSwitch } from "../components/ProjectViewSwitch";
import { ProjectIcon } from "~/components/ProjectIcon";
import { isCore, isProjectMember } from "~/lib/roles";
import { TaskBoard, type TaskCreateSeed } from "../components/TaskBoard";
import { ProjectMentorshipTab } from "~/mentorship/components/ProjectMentorshipTab";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import { LEGACY_TAB_TO_TAB } from "../lib/project-tabs";
import { loadProjectDetail } from "../lib/project-detail.server";
import { runProjectDetailAction } from "../lib/project-detail-actions.server";
import {
  OS_TABS,
  OS_TAB_LABELS,
  isOsTab,
  isTab,
  type OsTab,
  type Tab,
} from "~/projects/components/detail/constants";
import { ProjectHeader } from "~/projects/components/detail/ProjectHeader";
import { DeleteProjectSection, SaveAsTemplateSection, ScopeTab } from "~/projects/components/detail/ProjectSettings";
import { OverviewTab } from "~/projects/components/detail/OverviewTab";
import { ProjectDriveTab } from "~/projects/components/detail/ProjectDriveTab";
import { PlanningTab } from "~/projects/components/detail/PlanningTab";

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
