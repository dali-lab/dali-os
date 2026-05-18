import { redirect } from "react-router";
import type { Route } from "./+types/projects.$projectId.backlog";

// Backlog is a saved view of /tasks?sprint=backlog. Redirect to keep one
// implementation surface for task list/kanban.
export function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "list";
  return redirect(`/projects/${params.projectId}/tasks?sprint=backlog&view=${view}`);
}
