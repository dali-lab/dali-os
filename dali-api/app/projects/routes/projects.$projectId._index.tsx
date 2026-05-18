import { useOutletContext } from "react-router";
import type { Route } from "./+types/projects.$projectId._index";
import type { WorkspaceData } from "~/projects/lib/queries";
import type { ProjectMembership } from "~/lib/projectAuth";
import { OverviewTab } from "~/projects/components/OverviewTab";
import { requireAuth } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  return {
    userId: auth.user.sub,
    userFirstName: auth.user.firstName ?? "",
    userLastName: auth.user.lastName ?? "",
    collabToken: parseSessionCookie(request),
  };
}

type CtxData = { workspace: WorkspaceData; membership: ProjectMembership };

export default function OverviewRoute({ loaderData }: Route.ComponentProps) {
  const ctx = useOutletContext<CtxData>();
  return (
    <OverviewTab
      workspace={ctx.workspace}
      membership={ctx.membership}
      viewer={loaderData}
    />
  );
}
