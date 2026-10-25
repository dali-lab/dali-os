import { redirect } from "react-router";
import type { Route } from "./+types/admin.legacy-redirect";

// Admin's pre-sections URLs. Bookmarks, favorites, emails and audit-log links
// still point at these, so each one forwards to its new home with its query.
export const LEGACY_ADMIN_PATHS: Record<string, string> = {
  "/admin/system": "/admin",
  "/admin/payroll-export": "/admin/payroll/hire-setup",
  "/admin/site-users": "/admin/accounts/users",
  "/admin/security": "/admin/accounts/security",
  "/admin/outbound-messages": "/admin/messaging/outbox",
  "/admin/email-senders": "/admin/messaging/senders",
  "/admin/analytics": "/admin/insights/analytics",
  "/admin/ai-usage": "/admin/insights/ai-usage",
  "/admin/activity": "/admin/insights/audit-log",
  "/admin/jobs": "/admin/platform/jobs",
  "/admin/infrastructure": "/admin/platform/infrastructure",
  "/admin/feature-flags": "/admin/platform/flags",
  "/admin/activities": "/admin/onboarding",
};

export function legacyAdminTarget(pathname: string): string | null {
  const path = pathname.replace(/\/$/, "");
  if (LEGACY_ADMIN_PATHS[path]) return LEGACY_ADMIN_PATHS[path];
  const activity = path.match(/^\/admin\/activities\/([^/]+)$/);
  return activity ? `/admin/onboarding/${activity[1]}` : null;
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return redirect(`${legacyAdminTarget(url.pathname) ?? "/admin"}${url.search}${url.hash}`, 301);
}
