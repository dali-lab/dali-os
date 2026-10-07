import { Outlet, redirect, useLoaderData, useRouteError } from "react-router";
import { Home, FolderKanban } from "lucide-react";
import type { Route } from "./+types/partner-layout";
import { prisma } from "~/lib/db";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { maybeUpgradeLegacyToBetterAuth } from "~/lib/betterauth-upgrade.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getImpersonationState } from "~/lib/betterauth-compat.server";
import { impersonationAllowsWrites } from "~/lib/auth";
import { partnerProjectsWhereForOrgs } from "~/partners/lib/partner-access";
import { resolvePhotoUrl } from "~/lib/photo";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { LayoutPortalOS } from "~/components/LayoutPortalOS";
import type { PortalNavItem } from "~/lib/portal-nav";

// Partner portal chrome: the dali.os shell, same as the applicant portal, with
// a rail built from the account's projects instead of PORTAL_NAV. NOTE: this
// loader's requirePartnerAccount does NOT protect child routes (loaders run in
// parallel); every /partner route calls the guard itself.
export async function loader({ request }: Route.LoaderArgs) {
  const ctx = await requirePartnerAccount(request);

  // TEMPORARY (remove ~1 week post-cutover): migrate a validated legacy session
  // to a BetterAuth session, then reload so the new cookie takes effect. Reuses
  // ctx.auth; the helper's __dali_sid fast-path makes this zero-cost once the
  // legacy cookie is gone. Same migration as the member/portal loaders.
  const upgradeHeaders = await maybeUpgradeLegacyToBetterAuth(request, ctx.auth);
  if (upgradeHeaders) {
    const u = new URL(request.url);
    return redirect(u.pathname + u.search, { headers: upgradeHeaders });
  }

  const orgIds = ctx.memberships.map((m) => m.orgId);

  const me = await prisma.user.findUnique({
    where: { id: ctx.auth.user.sub },
    select: { photoUrl: true },
  });
  const avatarUrl = await resolvePhotoUrl(me?.photoUrl);

  // The account's projects across ALL memberships feed the rail's project
  // rows (see buildPartnerNav below).
  const projectRows =
    orgIds.length > 0
      ? await prisma.project.findMany({
          where: partnerProjectsWhereForOrgs(orgIds),
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            partners: {
              where: { partnerOrgId: { in: orgIds } },
              select: { partnerOrgId: true },
            },
          },
        })
      : [];

  // Group each project under the account's org that owns its partnership.
  const orgNameById = new Map(ctx.memberships.map((m) => [m.orgId, m.org.name]));
  const groups = new Map<
    string,
    { orgId: string; orgName: string; projects: { id: string; name: string }[] }
  >();
  for (const p of projectRows) {
    const orgId = p.partners.find((pp) => orgNameById.has(pp.partnerOrgId))
      ?.partnerOrgId;
    if (!orgId) continue;
    if (!groups.has(orgId)) {
      groups.set(orgId, {
        orgId,
        orgName: orgNameById.get(orgId) ?? "",
        projects: [],
      });
    }
    groups.get(orgId)!.projects.push({ id: p.id, name: p.name });
  }
  const orgGroups = [...groups.values()];

  // Show the org name as the rail's subtitle only when there is exactly one
  // membership (unambiguous). Multi-org and no-org accounts show nothing.
  const orgName =
    ctx.memberships.length === 1 ? ctx.memberships[0].org.name : null;

  // Surface the "Stop impersonating" banner when an admin is logged in as this
  // partner account, so they are never stranded in the partner shell.
  let impersonating = false;
  if (await isFeatureEnabledForEveryone("betterauth", request)) {
    try {
      impersonating = (await getImpersonationState(request)) !== null;
    } catch {
      // never let the impersonation probe fault the partner shell
    }
  }

  return { user: ctx.auth.user, orgName, orgGroups, avatarUrl, impersonating, impersonationWrites: impersonationAllowsWrites() };
}

type OrgGroup = {
  orgId: string;
  orgName: string;
  projects: { id: string; name: string }[];
};

// Home, then one row per project across every org the account belongs to.
// Across more than one org the label is disambiguated with the org name;
// within a single org the project name alone is unambiguous. No projects ⇒
// no rows beyond Home (pre-acceptance partners see just that).
function buildPartnerNav(orgGroups: OrgGroup[]): PortalNavItem[] {
  const multiOrg = orgGroups.length > 1;
  const projectRows: PortalNavItem[] = orgGroups.flatMap((g) =>
    g.projects.map((p) => ({
      label: multiOrg ? `${g.orgName} · ${p.name}` : p.name,
      href: `/partner/projects/${p.id}`,
      icon: FolderKanban,
    })),
  );
  return [{ label: "Home", href: "/partner", icon: Home }, ...projectRows];
}

export default function PartnerLayout() {
  const { user, orgName, orgGroups, avatarUrl, impersonating, impersonationWrites } = useLoaderData<typeof loader>();

  return (
    <LayoutPortalOS
      user={user}
      photoUrl={avatarUrl}
      nav={buildPartnerNav(orgGroups)}
      homeHref="/partner"
      settingsHref="/partner/settings"
      subtitle={orgName}
      impersonating={impersonating}
      impersonationAllowsWrites={impersonationWrites}
    >
      <Outlet />
    </LayoutPortalOS>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <div className="os-shell min-h-screen bg-os-bg text-foreground">
      <ApplicantErrorBoundary error={error} secondaryAction={{ kind: "reload" }} />
    </div>
  );
}
