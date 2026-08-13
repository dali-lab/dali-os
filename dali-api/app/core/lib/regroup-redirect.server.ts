import { redirect } from "react-router";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";

/**
 * Send a viewer who has nav-regroup on from a page's pre-regroup URL to its
 * canonical /core (or /projects) one, so each viewer sees exactly one address
 * for a page and the sidebar highlights the right area.
 *
 * Call this at the top of the SOURCE route's loader, never the alias's. The
 * alias modules re-export that same loader, so the `from`-prefix guard is what
 * keeps it inert on the new path — the same redirect-loop guard shape
 * admin.agreements.$id.tsx uses for its Drive aliases. Sub-paths and the query
 * string carry over, which is what makes in-page links
 * (/projects/intent-to-work → /projects/intent-to-work/:userId) land inside
 * Core without every link site needing to know about the flag.
 *
 * Returns null when the viewer is flag-off or already on the canonical path.
 * The path check runs first, so a request that is already on /core costs
 * nothing — the roles + flag lookups only happen on the redirecting hop.
 */
export async function regroupRedirect(
  request: Request,
  userId: string,
  from: string,
  to: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== from && !url.pathname.startsWith(from + "/")) return null;
  const roles = await getUserRoles(userId);
  if (!(await isFeatureEnabled("nav-regroup", userId, roles))) return null;
  return redirect(to + url.pathname.slice(from.length) + url.search);
}
