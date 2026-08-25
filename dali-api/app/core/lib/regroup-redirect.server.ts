import { redirect } from "react-router";

/**
 * Send a request on a page's pre-regroup URL to its canonical /core (or
 * /projects) one, so each page has exactly one address and the sidebar
 * highlights the right area.
 *
 * Call this at the top of the SOURCE route's loader, never the alias's. The
 * alias modules re-export that same loader, so the `from`-prefix guard is what
 * keeps it inert on the new path — the same redirect-loop guard shape
 * core.agreements.$id.tsx uses for its Drive aliases. Sub-paths and the query
 * string carry over, which is what makes in-page links
 * (/projects/intent-to-work → /projects/intent-to-work/:userId) land inside
 * Core without every link site needing to know the canonical path.
 *
 * The nav-regroup flag was retired, so this now redirects unconditionally: the
 * regrouped nav is the only nav. `userId` is retained on the signature so the
 * ~dozen call sites (which pass `auth.user.sub`) need no change. Returns null
 * when the request is already on the canonical path.
 */
export function regroupRedirect(
  request: Request,
  _userId: string,
  from: string,
  to: string,
): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== from && !url.pathname.startsWith(from + "/")) return null;
  return redirect(to + url.pathname.slice(from.length) + url.search);
}
