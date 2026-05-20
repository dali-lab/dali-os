import { useState } from "react";
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
import { EditModeToggle, useEditMode } from "~/components/EditModeToggle";
import type { TaskCardModel, TaskStatus, Priority } from "../lib/task-board";

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
      firstTerm: { select: { code: true } },
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
          user: { select: { firstName: true, lastName: true } },
          term: { select: { code: true, sortKey: true } },
          domain: { select: { name: true } },
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
          assignees: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
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
    assigneeNames: t.assignees.map((a) => `${a.user.firstName} ${a.user.lastName}`.trim()),
  }));

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
    },
    teams,
    termStatuses,
    documents,
    epics,
    editableEpics,
    sprints,
    tasks,
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
    canEdit: canEditPerm,
    collabToken,
    userName,
  } = useLoaderData() as LoaderData;
  const { editing: canEdit, editMode, setEditMode } = useEditMode(canEditPerm);
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
      <div className="flex items-center justify-between">
        <Link to="/projects/list" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to projects
        </Link>
        <EditModeToggle
          canEdit={canEditPerm}
          editMode={editMode}
          setEditMode={setEditMode}
        />
      </div>

      {/* Overview header — always on top, not behind a tab */}
      <ProjectHeader
        project={project}
        partnerNames={partnerNames}
        canEdit={canEdit}
      />

      {/* Tab bar */}
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
          canEdit={canEditPerm}
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
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit ? (
            // In edit mode the name is directly editable and auto-saves on
            // blur — same pattern as the status dropdown, no separate Save.
            // Carries the current status as a hidden field so the
            // intent=header action branch (which requires both) is unchanged.
            <Form method="post" className="flex items-center gap-2">
              <input type="hidden" name="intent" value="header" />
              <input type="hidden" name="status" value={project.status} />
              <input
                name="name"
                defaultValue={project.name}
                aria-label="Project name"
                onBlur={(e) => {
                  const next = e.currentTarget.value.trim();
                  if (next && next !== project.name) {
                    submit(e.currentTarget.form);
                  }
                }}
                className="font-heading text-xl font-bold text-foreground px-2 py-1 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </Form>
          ) : (
            <h1 className="font-heading text-2xl font-bold text-foreground">
              {project.name}
            </h1>
          )}

          {/* Status: always-visible dropdown that auto-saves on change.
              Carries the current name as a hidden field so the intent=header
              branch gets both. Read-only badge when the user can't edit. */}
          {canEdit ? (
            <Form method="post" onChange={(e) => submit(e.currentTarget)}>
              <input type="hidden" name="intent" value="header" />
              <input type="hidden" name="name" value={project.name} />
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
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
              {project.status}
            </span>
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
  const [editing, setEditing] = useState(false);

  if (!canEdit) {
    return (
      <section className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-foreground mb-2">Description</h2>
        {description ? (
          <p className="text-sm text-foreground whitespace-pre-wrap">{description}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">No description.</p>
        )}
      </section>
    );
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-foreground">Description</h2>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-accent-coral hover:underline"
          >
            {description ? "Edit" : "+ Add description"}
          </button>
        )}
      </div>
      {editing ? (
        <Form
          method="post"
          onSubmit={() => setEditing(false)}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="intent" value="description" />
          <textarea
            name="description"
            rows={4}
            autoFocus
            defaultValue={description ?? ""}
            placeholder="What is this project about?"
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
            >
              Save
            </button>
          </div>
        </Form>
      ) : description ? (
        <p className="text-sm text-foreground whitespace-pre-wrap">{description}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">No description yet.</p>
      )}
    </section>
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
  canEdit,
  actionError,
  collabToken,
  userName,
}: {
  project: LoaderData["project"];
  teams: LoaderData["teams"];
  documents: LoaderData["documents"];
  canEdit: boolean;
  actionError?: string;
  collabToken: string | null;
  userName: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {actionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionError}
        </div>
      )}

      {/* Description — its own segment on top, separate from Project details */}
      <DescriptionSegment description={project.description} canEdit={canEdit} />

      <Form
        method="post"
        className="bg-card border border-border rounded-lg p-4 flex flex-col gap-4 w-full"
      >
        <input type="hidden" name="intent" value="details" />
        <h2 className="text-sm font-semibold text-foreground">Project details</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Calendar email</span>
            {canEdit ? (
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
            {canEdit ? (
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
            {canEdit ? (
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
          <span className="text-muted-foreground">Repositories (one URL per line)</span>
          {canEdit ? (
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
            <span className="px-2 py-1.5 text-sm text-muted-foreground">—</span>
          )}
        </label>

        {/* Team — read-only. Current term by default, expandable to all. */}
        <TeamSection teams={teams} />

        {canEdit && (
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
            >
              Save changes
            </button>
          </div>
        )}
      </Form>

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
  canEdit,
}: {
  projectId: string;
  epics: TimelineEpic[];
  editableEpics: EditableEpic[];
  sprints: EditableSprint[];
  tasks: TaskCardModel[];
  canEdit: boolean;
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
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Task board</h2>
        <TaskBoard projectId={projectId} initialTasks={tasks} canManage={canEdit} />
      </section>
    </div>
  );
}

