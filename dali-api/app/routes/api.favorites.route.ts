import type { Route } from "./+types/api.favorites.route";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { favoriteHrefs, setRouteFavorite } from "~/lib/user-pages.server";

// POST /api/favorites/route — star or un-star a URL inside the app (a project
// hub, a subtab). Body: { href, label, favorited }.
//
// Separate from /api/pages/:id/favorite because there is no page to authorise
// against: the destination re-checks its own permissions when opened, so a
// bookmark grants nothing. The href is confined to same-origin paths so this
// can't be used to park arbitrary links on someone's home page.

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
  const hrefs = await favoriteHrefs(gate.auth.user.sub);
  // No href = "give me all of them", so a tab bar resolves its whole row in one
  // request instead of one per tab.
  if (href === null) {
    return withCors(request, Response.json({ ok: true, hrefs: [...hrefs] }));
  }
  return withCors(request, Response.json({ ok: true, favorited: hrefs.has(href) }));
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

  const label = body.label.trim().slice(0, 200) || body.href;
  await setRouteFavorite(gate.auth.user.sub, body.href, label, body.favorited);
  return withCors(request, Response.json({ ok: true, favorited: body.favorited }));
}
