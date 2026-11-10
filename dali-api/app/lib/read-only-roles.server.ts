import { getUserRoles } from "~/lib/roles";
import { cachedForLayout } from "~/lib/layout-cache.server";

/**
 * The viewer's roles through the layout cache, up to a TTL stale (see
 * layout-cache.server.ts). Only for GET loaders and read-only API routes that
 * shape what a page shows. Never in an action, never to gate a write, never in
 * a `requireX`-style guard: those call `getUserRoles` and read fresh.
 * Non-members are never cached, so one who was just accepted isn't bounced.
 */
export function readOnlyRoles(userId: string, request: Request) {
  return cachedForLayout(userId, "roles", () => getUserRoles(userId, request), {
    shouldCache: (roles) => roles.isLabMember,
  });
}
