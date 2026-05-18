import { redirect, useLoaderData, Outlet } from "react-router";
import type { Route } from "./+types/projects.$projectId";
import { requireAuth } from "~/lib/auth";
import { getProjectWorkspace } from "~/projects/lib/queries";
import { getProjectMembership } from "~/lib/projectAuth";
import { ProjectWorkspaceLayout } from "~/projects/components/ProjectWorkspaceLayout";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { workspace?: { project: { name: string } } } | undefined)
    ?.workspace?.project.name;
  return [{ title: `${name ?? "Project"} · DALI OS` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const projectId = params.projectId!;
  const [workspace, membership] = await Promise.all([
    getProjectWorkspace(projectId),
    getProjectMembership(auth.user.sub, projectId),
  ]);
  if (!workspace) {
    throw new Response("Project not found", { status: 404 });
  }
  return { workspace, membership };
}

export default function ProjectWorkspaceRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <ProjectWorkspaceLayout workspace={data.workspace} membership={data.membership}>
      <Outlet context={data} />
    </ProjectWorkspaceLayout>
  );
}
