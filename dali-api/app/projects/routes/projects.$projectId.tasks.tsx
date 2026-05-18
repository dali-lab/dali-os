import { redirect, useOutletContext } from "react-router";
import type { Route } from "./+types/projects.$projectId.tasks";
import { requireAuth } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import {
  listTasks,
  listSprints,
  listEpics,
  type WorkspaceData,
} from "~/projects/lib/queries";
import { TasksTab } from "~/projects/components/TasksTab";
import type { ProjectMembership } from "~/lib/projectAuth";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const projectId = params.projectId!;
  const url = new URL(request.url);
  const sprintFilter = url.searchParams.get("sprint"); // sprint id or "backlog"
  const epicFilter = url.searchParams.get("epic");
  const view = url.searchParams.get("view") === "list" ? "list" : "board";

  const taskFilter: { sprintId?: string | null; epicId?: string | null } = {};
  if (sprintFilter === "backlog") taskFilter.sprintId = null;
  else if (sprintFilter) taskFilter.sprintId = sprintFilter;
  if (epicFilter) taskFilter.epicId = epicFilter;

  const [tasks, sprints, epics] = await Promise.all([
    listTasks(projectId, taskFilter),
    listSprints(projectId),
    listEpics(projectId),
  ]);

  return {
    tasks,
    sprints,
    epics,
    view: view as "board" | "list",
    sprintFilter: sprintFilter ?? null,
    epicFilter: epicFilter ?? null,
    collabToken: parseSessionCookie(request),
    viewer: {
      id: auth.user.sub,
      firstName: auth.user.firstName ?? "",
      lastName: auth.user.lastName ?? "",
    },
  };
}

type CtxData = { workspace: WorkspaceData; membership: ProjectMembership };

export default function TasksRoute({ loaderData }: Route.ComponentProps) {
  const ctx = useOutletContext<CtxData>();
  return (
    <TasksTab
      data={loaderData}
      workspace={ctx.workspace}
      membership={ctx.membership}
    />
  );
}
