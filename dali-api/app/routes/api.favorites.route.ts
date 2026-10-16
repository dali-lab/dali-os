import type { Route } from "./+types/api.favorites.route";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { getPageAccess } from "~/lib/pageAccess.server";
import {
  canonicalRouteHref,
  favoriteHrefs,
  isFavorited,
  setFavorite,
  setRouteFavorite,
  starTargetForUrl,
} from "~/lib/user-pages.server";
import { isNavbarRoute } from "~/lib/navbar-routes";

// POST /api/favorites/route — star or un-star a URL inside the app (a project
// hub, a subtab). Body: { href, label, favorited }.
//
// A plain route has no page to authorise against: the destination re-checks its
// own permissions when opened, so a bookmark grants nothing. The href is
// confined to same-origin paths so this can't be used to park arbitrary links
// on someone's home page. Document, form and whiteboard URLs are Pages, so they
// dispatch to the page favorite behind a canView check.

type Body = { href: string; label: string; favorited: boolean };

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  return (
    typeof b.href === "string" && typeof b.label === "string" && typeof b.favorited === "boolean"
  );
}

// Same-origin, absolute path only. Rejects "//evil.com" (protocol-relative) and
// anything with a scheme.
function isSafePath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.includes("://");
}

// GET /api/favorites/route?href=… — is this URL starred? The subtab bar renders
// on dozens of routes, so it asks here rather than every one of those loaders
// carrying the answer.
export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  const href = new URL(request.url).searchParams.get("href");
  const userId = gate.auth.user.sub;
  if (href !== null) {
    const target = starTargetForUrl(href);
    if (target.kind === "page") {
      return withCors(
        request,
        Response.json({ ok: true, favorited: await isFavorited(userId, target.pageId) }),
      );
    }
  }
  const hrefs = await favoriteHrefs(userId);
  // No href = "give me all of them", so a tab bar resolves its whole row in one
  // request instead of one per tab.
  if (href === null) {
    return withCors(request, Response.json({ ok: true, hrefs: [...hrefs] }));
  }
  // The page asks with the URL it is on, tab query and all; the stored identity
  // of a detail route is just its path (canonicalRouteHref).
  return withCors(request, Response.json({ ok: true, favorited: hrefs.has(canonicalRouteHref(href)) }));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }
  if (!isSafePath(body.href)) {
    return withCors(request, Response.json({ error: "Invalid href" }, { status: 400 }));
  }
  const userId = gate.auth.user.sub;
  const target = starTargetForUrl(body.href);
  if (target.kind === "page") {
    // Same 404 whether the page is missing or merely unreadable, so starring
    // can't probe which page ids exist.
    const access = await getPageAccess(userId, target.pageId);
    if (!access.canView) {
      return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
    }
    await setFavorite(userId, target.pageId, body.favorited);
    return withCors(request, Response.json({ ok: true, favorited: body.favorited }));
  }
  if (body.favorited && isNavbarRoute(body.href)) {
    return withCors(request, Response.json({ error: "This page cannot be favorited" }, { status: 400 }));
  }

  const label = body.label.trim().slice(0, 200) || body.href;
  await setRouteFavorite(userId, body.href, label, body.favorited);
  return withCors(request, Response.json({ ok: true, favorited: body.favorited }));
}
