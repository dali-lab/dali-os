import type { Route } from "./+types/api.mobile.projects";
import { runListMyProjects } from "~/mcp/tools/list-my-projects";
import { termFactsForUser } from "~/lib/mobile-members.server";
import { leadLabels } from "~/lib/mobile-format";
import { mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;

  const [{ projects }, facts] = await Promise.all([
    runListMyProjects(guard.userId, {}),
    termFactsForUser(guard.userId, null),
  ]);
  const myLeadRole = facts ? leadLabels(facts)[0] ?? null : null;

  return mobileJson({
    projects: projects
      // Only what the member is staffed on this term; past projects stay on the web.
      .filter((p) => p.status !== "Archived" && p.currentTermAssignment !== null)
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        terms: p.terms,
        myRole: p.currentTermAssignment?.domainName ?? null,
        myLeadRole,
      })),
  });
}
