import { useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  useSubmit,
} from "react-router";
import { Check, Pencil, X } from "lucide-react";
import { EditableSection } from "~/components/EditableSection";
import type { Route } from "./+types/projects.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { isHiringLead } from "~/lib/roles";
import { TaskBoard } from "../components/TaskBoard";
import { type TimelineEpic, type EpicStatus } from "../components/EpicsTimeline";
import {
  EpicSprintManager,
  type EditableEpic,
  type EditableSprint,
} from "../components/EpicSprintManager";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
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

const STATUSES = ["Active", "Paused", "Archived"] as const;
type ProjectStatus = (typeof STATUSES)[number];

const TABS = ["overview", "work"] as const;
type Tab = (typeof TABS)[number];
function isTab(x: string | null): x is Tab {
  return x === "overview" || x === "work";
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      calendarEmail: true,
      imageUrl: true,
      repoUrls: true,
      overviewPageId: true,
      prdPageId: true,
      firstTerm: { select: { id: true, code: true, sortKey: true } },
      termCount: true,
      partners: { select: { partnerOrg: { select: { name: true } } } },
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
          level: true,
          user: { select: { id: true, firstName: true, lastName: true } },
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
          status: true,
          priority: true,
          position: true,
          dueAt: true,
          epicId: true,
          sprintId: true,
          domain: { select: { id: true, displayName: true } },
          assignees: {
            select: {
              user: { select: { id: true, firstName: true, lastName: true } },
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

  // Project documents — top-level, non-archived FreeForm Pages scoped to
  // this project's workspace.
  const documentRows = await prisma.page.findMany({
    where: {
      workspaceType: "Project",
      workspaceId: project.id,
      parentPageId: null,
      archivedAt: null,
    },
    orderBy: { position: "asc" },
    select: { id: true, title: true },
  });
  const documents = documentRows.map((d) => ({ id: d.id, title: d.title }));

  // Admin or Core members may edit projects (isHiringLead === Admin || Core).
  const canEdit = await isHiringLead(auth.user.sub);

  // Collab editor wiring (same as the hiring routes): session cookie is the
  // WebSocket auth token; userName labels the presence cursor.
  const collabToken = parseSessionCookie(request);
  const userName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
    auth.user.email;

  // Timeline span: prefer the epic's explicit startsAt/endsAt; fall back to
  // the min/max of its sprint dates when either is unset. Each epic also
  // carries its own sprint rows (ordered by start) so the timeline can render
  // one bar per sprint with connectors, not just a single epic bar.
  const epics: TimelineEpic[] = project.epics.map((e) => {
    const epicSprints = project.sprints
      .filter((s) => s.epicId === e.id)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const starts = epicSprints.map((s) => s.startsAt.getTime());
    const ends = epicSprints.map((s) => s.endsAt.getTime());
    const sprintStart = starts.length ? new Date(Math.min(...starts)).toISOString() : null;
    const sprintEnd = ends.length ? new Date(Math.max(...ends)).toISOString() : null;
    return {
      id: e.id,
      title: e.title,
      status: e.status as EpicStatus,
      startsAt: e.startsAt ? e.startsAt.toISOString() : sprintStart,
      endsAt: e.endsAt ? e.endsAt.toISOString() : sprintEnd,
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
    status: t.status as TaskStatus,
    priority: t.priority as Priority,
    position: t.position,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    epicId: t.epicId,
    sprintId: t.sprintId,
    assignees: t.assignees.map((a) => ({
      id: a.user.id,
      name: `${a.user.firstName} ${a.user.lastName}`.trim(),
    })),
    domain: t.domain
      ? { id: t.domain.id, name: t.domain.displayName }
      : null,
  }));

  // Board option lists for the TaskModal: members assignable on this project
  // (deduped across terms — same person across multiple terms shows once) and
  // every active domain.
  const memberMap = new Map<string, string>();
  for (const a of project.assignments) {
    const id = a.user.id;
    if (!memberMap.has(id)) {
      memberMap.set(id, `${a.user.firstName} ${a.user.lastName}`.trim());
    }
  }
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
  };

  // Team grouped by term, newest term first. Current = highest sortKey.
  const teamByTerm = new Map<
    string,
    { code: string; sortKey: number; members: { name: string; domain: string; level: string }[] }
  >();
  for (const a of project.assignments) {
    const key = a.term.code;
    if (!teamByTerm.has(key)) {
      teamByTerm.set(key, { code: a.term.code, sortKey: a.term.sortKey, members: [] });
    }
    teamByTerm.get(key)!.members.push({
      name: `${a.user.firstName} ${a.user.lastName}`.trim(),
      domain: a.domain.name,
      level: a.level,
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
  const [allDomains, bidDomains] = await Promise.all([
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
  ]);
  const declaredDomains = project.domains.map((d) => ({
    id: d.domain.id,
    name: d.domain.displayName,
  }));

  // Planned terms for the scope grid: starting at firstTerm (by sortKey), the
  // next `termCount` terms chronologically. We fetch them ascending so the
  // `take: termCount` slice cuts off the future, then reverse so the display
  // surfaces the most recent term first. Falls back to an empty list when
  // no firstTerm is set (legacy project rows) — the scopes section then
  // just doesn't render, no crash.
  const plannedTerms: { id: string; code: string; sortKey: number }[] = (
    project.firstTerm
      ? await prisma.term.findMany({
          where: { sortKey: { gte: project.firstTerm.sortKey } },
          orderBy: { sortKey: "asc" },
          take: Math.max(1, project.termCount),
          select: { id: true, code: true, sortKey: true },
        })
      : []
  )
    .slice()
    .sort((a, b) => b.sortKey - a.sortKey);

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

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      calendarEmail: project.calendarEmail,
      imageUrl: project.imageUrl,
      repoUrls: project.repoUrls,
      overviewPageId: project.overviewPageId,
      prdPageId: project.prdPageId,
      firstTerm: project.firstTerm,
      termCount: project.termCount,
      partners: project.partners,
      domains: declaredDomains,
      derivedDomains,
    },
    allDomainOptions: allDomains.map((d) => ({ id: d.id, name: d.displayName })),
    plannedTerms: plannedTerms.map((t) => ({ id: t.id, code: t.code })),
    domainScopeGrid,
    teams,
    termStatuses,
    documents,
    epics,
    editableEpics,
    sprints,
    tasks,
    boardOptions,
    canEdit,
    collabToken,
    userName,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  if (!(await isHiringLead(auth.user.sub))) {
    return { error: "You don't have permission to edit this project." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "details";

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

  // Details form: calendar email, image, repos. (Description + name/status
  // are saved by their own segments above.)
  const calendarEmailRaw = (form.get("calendarEmail") as string | null)?.trim() ?? "";
  const imageUrlRaw = (form.get("imageUrl") as string | null)?.trim() ?? "";
  const repoUrlsRaw = (form.get("repoUrls") as string | null) ?? "";
  const termCountRaw = (form.get("termCount") as string | null) ?? "";

  // repoUrls textarea: one URL per line, blanks dropped.
  const repoUrls = repoUrlsRaw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // termCount is the planned span (≥1 consecutive terms from the start term).
  // Blank/invalid falls back to 1 rather than erroring the whole form.
  const termCount = Math.max(1, Math.floor(Number(termCountRaw)) || 1);

  await prisma.project.update({
    where: { id: params.id },
    data: {
      calendarEmail: calendarEmailRaw === "" ? null : calendarEmailRaw,
      imageUrl: imageUrlRaw === "" ? null : imageUrlRaw,
      repoUrls,
      termCount,
    },
  });
  return redirect(`/projects/${params.id}`);
}

export default function ProjectDetail() {
  const {
    project,
    teams,
    documents,
    epics,
    editableEpics,
    sprints,
    tasks,
    boardOptions,
    allDomainOptions,
    plannedTerms,
    domainScopeGrid,
    canEdit,
    collabToken,
    userName,
  } = useLoaderData() as LoaderData;
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const partnerNames = project.partners.map((p) => p.partnerOrg.name);

  const tabParam = searchParams.get("tab");
  const tab: Tab = isTab(tabParam) ? tabParam : "overview";
  const setTab = (next: Tab) => {
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/projects/list"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to projects
      </Link>

      {/* Overview header — always on top, not behind a tab */}
      <ProjectHeader
        project={project}
        partnerNames={partnerNames}
        canEdit={canEdit}
      />

      {/* Tab bar. Each section now owns its own edit button — there's no
          page-level edit mode left to clear when switching tabs. */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
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
            {t === "overview" ? "Overview" : "Work"}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab
          project={project}
          teams={teams}
          documents={documents}
          allDomainOptions={allDomainOptions}
          plannedTerms={plannedTerms}
          domainScopeGrid={domainScopeGrid}
          canEdit={canEdit}
          actionError={actionData?.error}
          collabToken={collabToken}
          userName={userName}
        />
      ) : (
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
          canEdit={canEdit}
          collabToken={collabToken}
          userName={userName}
        />
      )}
    </div>
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

  const subtitle = (
    <p className="text-sm text-muted-foreground mt-1">
      {project.firstTerm
        ? `Start term ${project.firstTerm.code}`
        : "No start term"}
      {" · "}
      {project.termCount} {project.termCount === 1 ? "term" : "terms"}
      {" · "}
      {partnerNames.length > 0 ? partnerNames.join(", ") : "No partners"}
    </p>
  );

  return (
    <header className="flex flex-col gap-4">
      {project.imageUrl && (
        <img
          src={project.imageUrl}
          alt=""
          className="w-full h-48 rounded-lg object-cover border border-border"
        />
      )}
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
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                  {project.status}
                </span>
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
                  <button
                    type="button"
                    onClick={() => {
                      setResetKey((k) => k + 1);
                      setEditing(false);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (formRef.current) submit(formRef.current);
                      setEditing(false);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Save
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="Edit project name and status"
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
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
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) =>
        editing ? (
          <Form method="post" ref={formRef} className="flex flex-col gap-2">
            <input type="hidden" name="intent" value="description" />
            <textarea
              name="description"
              rows={4}
              defaultValue={description ?? ""}
              placeholder="Add a short description…"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              autoFocus
            />
          </Form>
        ) : description ? (
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {description}
          </p>
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

// Calendar email + image URL + term count + repo URLs. One form posting
// intent=details with the full field set, so the action handler stays
// unchanged. Section-level Save submits; Cancel reverts via the wrapper.
function DetailsSegment({
  project,
  canEdit,
}: {
  project: LoaderData["project"];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Project details"
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

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Image URL</span>
              {editing ? (
                <input
                  name="imageUrl"
                  type="url"
                  defaultValue={project.imageUrl ?? ""}
                  placeholder="https://…"
                  className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
              ) : (
                <span className="px-2 py-1.5 text-sm text-foreground">
                  {project.imageUrl ?? "—"}
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

function TeamSection({ teams }: { teams: LoaderData["teams"] }) {
  const [showAll, setShowAll] = useState(false);
  // teams is pre-sorted newest term first by the loader.
  const visible = showAll ? teams : teams.slice(0, 1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Team</span>
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
                {team.code === teams[0].code && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-accent-teal/15 text-accent-teal">
                    Current
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {team.members.map((m, j) => (
                  <span
                    key={j}
                    className="text-xs px-2 py-1 rounded-md border border-border text-foreground"
                  >
                    {m.name}
                    <span className="text-muted-foreground">
                      {" "}
                      · {m.domain} {m.level}
                    </span>
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

function OverviewTab({
  project,
  teams,
  documents,
  allDomainOptions,
  plannedTerms,
  domainScopeGrid,
  canEdit,
  actionError,
  collabToken,
  userName,
}: {
  project: LoaderData["project"];
  teams: LoaderData["teams"];
  documents: LoaderData["documents"];
  allDomainOptions: LoaderData["allDomainOptions"];
  plannedTerms: LoaderData["plannedTerms"];
  domainScopeGrid: LoaderData["domainScopeGrid"];
  canEdit: boolean;
  actionError?: string;
  collabToken: string | null;
  userName: string;
}) {
  const submit = useSubmit();

  return (
    <div className="flex flex-col gap-4">
      {actionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionError}
        </div>
      )}

      {/* Description — its own segment on top, separate from Project details */}
      <DescriptionSegment description={project.description} canEdit={canEdit} />

      {/* Declared domains — editable; if none declared the derived set from
          assignments + bids is shown as a fallback so a freshly-created
          project that's mid-staffing still has visible domain context. */}
      <DomainsSegment
        declared={project.domains}
        derived={project.derivedDomains}
        allDomains={allDomainOptions}
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

      {/* Project details. Editable as one section; commits via intent=details
          which expects the full field set. Section-level Save submits and
          closes; Cancel reverts (the wrapper remounts the body which resets
          defaultValue inputs). */}
      <DetailsSegment project={project} canEdit={canEdit} />

      {/* Team — read-only summary, separate from the editable details. */}
      <section className="bg-card border border-border rounded-lg p-4">
        <TeamSection teams={teams} />
      </section>

      {/* Documents block */}
      <DocumentsBlock
        projectId={project.id}
        documents={documents}
        canEdit={canEdit}
        collabToken={collabToken}
        userName={userName}
      />
    </div>
  );
}

function DocumentsBlock({
  projectId,
  documents,
  canEdit,
  collabToken,
  userName,
}: {
  projectId: string;
  documents: LoaderData["documents"];
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
}) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  // Which document's body editor is expanded open (null = none).
  const [openId, setOpenId] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    fn()
      .then(() => revalidator.revalidate())
      .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong"))
      .finally(() => setBusy(false));
  }

  async function call(url: string, method: "POST" | "DELETE", body?: unknown) {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? `Request failed: ${res.status}`);
    }
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Documents</h2>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-medium text-accent-coral hover:underline"
          >
            + Add document
          </button>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const title = draft.trim();
            if (!title) return;
            run(async () => {
              await call(`/api/projects/${projectId}/documents`, "POST", { title });
              setAdding(false);
              setDraft("");
            });
          }}
          className="flex items-end gap-2 mb-3"
        >
          <label className="flex flex-col gap-1 text-xs flex-1">
            <span className="text-muted-foreground">Title</span>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 transition-colors"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setDraft("");
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      {documents.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground italic">No documents yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {documents.map((doc) =>
            editId === doc.id ? (
              <form
                key={doc.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const title = editTitle.trim();
                  if (!title) return;
                  run(async () => {
                    await call(`/api/documents/${doc.id}`, "POST", { title });
                    setEditId(null);
                  });
                }}
                className="py-2 flex items-end gap-2"
              >
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditId(null)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div key={doc.id} className="py-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === doc.id ? null : doc.id)}
                    className="text-foreground truncate text-left hover:text-accent-coral"
                    title={openId === doc.id ? "Collapse" : "Open"}
                  >
                    {openId === doc.id ? "▾ " : "▸ "}
                    {doc.title}
                  </button>
                  {canEdit && (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditId(doc.id);
                          setEditTitle(doc.title);
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Delete document "${doc.title}"?`)) return;
                          run(() => call(`/api/documents/${doc.id}`, "DELETE"));
                        }}
                        className="text-xs text-destructive hover:underline disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {openId === doc.id && (
                  <div className="mt-2">
                    {collabToken ? (
                      <PresenceProvider
                        pageId={`doc:${doc.id}`}
                        token={collabToken}
                        userName={userName}
                      >
                        <CollaborativeEditor
                          editorId={`doc:${doc.id}:body`}
                          documentName={`doc:${doc.id}:body`}
                          token={collabToken}
                          userName={userName}
                          disabled={!canEdit}
                          placeholder="Start writing…"
                          className="border border-border rounded-md"
                        />
                      </PresenceProvider>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Sign in again to edit this document.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function WorkTab({
  projectId,
  epics,
  editableEpics,
  sprints,
  tasks,
  boardOptions,
  canEdit,
  collabToken,
  userName,
}: {
  projectId: string;
  epics: TimelineEpic[];
  editableEpics: EditableEpic[];
  sprints: EditableSprint[];
  tasks: TaskCardModel[];
  boardOptions: TaskBoardOptions;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Epics &amp; sprints</h2>
        <EpicSprintManager
          projectId={projectId}
          timelineEpics={epics}
          epics={editableEpics}
          sprints={sprints}
          canManage={canEdit}
          collabToken={collabToken}
          userName={userName}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Task board</h2>
        <TaskBoard
          projectId={projectId}
          initialTasks={tasks}
          options={boardOptions}
          canManage={canEdit}
        />
      </section>
    </div>
  );
}

