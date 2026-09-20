import { Outlet, useLoaderData, Link, useMatches } from "react-router";
import type { Route } from "./+types/applicant-layout";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import { getUserRoles } from "~/lib/roles";
import { resolveFeatureFlags } from "~/lib/feature-flags.server";
import type { FeatureFlagMap } from "~/lib/feature-flags";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { LayoutPortalOS } from "~/components/LayoutPortalOS";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;
  const me = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { photoUrl: true },
  });
  // Feature flags for the portal: the member shell resolves these in its own
  // layout, but the applicant portal is a separate layout — without this, every
  // /portal/* page reads flags as off (useFeatureFlag falls back to false).
  const roles = await getUserRoles(auth.user.sub);
  const [avatarUrl, flags] = await Promise.all([
    resolvePhotoUrl(me?.photoUrl),
    resolveFeatureFlags(auth.user.sub, roles),
  ]);
  return { user: auth.user, avatarUrl, flags };
}

export default function ApplicantLayout() {
  const { user, avatarUrl, flags } = useLoaderData<typeof loader>() as {
    user: { sub: string; email: string; type: string; firstName?: string; lastName?: string };
    avatarUrl: string | null;
    flags: FeatureFlagMap;
  };

  // A page that declares `fitViewport` (the calendar's hour grid) fills the
  // shell's main column instead of growing past it, so it scrolls inside its
  // own panes rather than forcing a page scrollbar under the shell chrome.
  const matches = useMatches();
  const fitViewport = matches.some(
    (m) => (m as { handle?: { fitViewport?: boolean } }).handle?.fitViewport,
  );

  return (
    <LayoutPortalOS user={user} photoUrl={avatarUrl} fitViewport={fitViewport}>
      <FeatureFlagsProvider flags={flags}>
        <Outlet />
      </FeatureFlagsProvider>
    </LayoutPortalOS>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // Layout-level boundary catches errors from this route's own loader
  // (e.g. requireAuth). Auth state is unknown here, so render a minimal
  // shell without the user-identity rail to avoid misrepresenting it.
  return (
    <div className="os-shell min-h-screen bg-os-bg text-foreground">
      <nav className="os-nav-edge-b flex h-16 items-center bg-os-nav px-4 sm:px-6">
        <Link to="/portal" className="font-os-logo text-2xl font-semibold text-os-accent">
          dali.os
        </Link>
      </nav>
      <ApplicantErrorBoundary error={error} secondaryAction={{ kind: "reload" }} />
    </div>
  );
}
