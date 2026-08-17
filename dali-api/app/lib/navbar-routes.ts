// Sidebar destinations and their hub subtabs — not star-able as routes.
// Documents use FavoriteStar; DB detail pages (project, person, partner org)
// use FavoriteRouteButton on the breadcrumb.

const NAVBAR_PATHS = new Set([
  "/",
  "/notifications",
  "/projects",
  "/core",
  "/drive",
  "/members",
  "/members/groups",
  "/partners",
  "/partners/applications",
  "/calendar",
  "/settings",
  "/help",
]);

export function isNavbarRoute(href: string): boolean {
  const path = new URL(href, "http://local").pathname;
  if (NAVBAR_PATHS.has(path)) return true;
  if (path.startsWith("/settings/")) return true;
  if (path.startsWith("/help/")) return true;
  if (path.startsWith("/forms/")) return true;
  if (path.startsWith("/partners/applications/")) return true;
  return false;
}

/** Hub pages with no breadcrumb trail — skip the layout header row entirely. */
export function isNavbarHubPage(href: string): boolean {
  const path = new URL(href, "http://local").pathname;
  if (NAVBAR_PATHS.has(path)) return true;
  if (path.startsWith("/settings/") || path.startsWith("/help/")) return true;
  return false;
}
