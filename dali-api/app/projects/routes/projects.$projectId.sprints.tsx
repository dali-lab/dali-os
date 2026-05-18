import { redirect, useOutletContext } from "react-router";
import type { Route } from "./+types/projects.$projectId.sprints";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { listSprints, type WorkspaceData } from "~/projects/lib/queries";
import { SprintsTab } from "~/projects/components/SprintsTab";
import type { ProjectMembership } from "~/lib/projectAuth";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const projectId = params.projectId!;
  const [sprints, taskCounts] = await Promise.all([
    listSprints(projectId),
    prisma.task.groupBy({
      by: ["sprintId", "status"],
      where: { projectId },
      _count: true,
    }),
  ]);

  return { sprints, taskCounts };
}

type CtxData = { workspace: WorkspaceData; membership: ProjectMembership };

export default function SprintsRoute({ loaderData }: Route.ComponentProps) {
  const ctx = useOutletContext<CtxData>();
  return (
    <SprintsTab
      data={loaderData}
      workspace={ctx.workspace}
      membership={ctx.membership}
    />
  );
}
