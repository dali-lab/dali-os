import {
  Link,
  NavLink,
  Outlet,
  useLoaderData,
  useLocation,
  useRouteError,
} from "react-router";
import { ChevronDown } from "lucide-react";
import type { Route } from "./+types/partner-layout";
import { prisma } from "~/lib/db";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { partnerProjectsWhereForOrgs } from "~/partners/lib/partner-access";
import { userInitials } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { PortalProfileMenu } from "~/components/PortalProfileMenu";
import { Menu } from "~/components/ui/floating";

// Partner portal chrome: fixed top navbar, no member sidebar — the same
// shape as the applicant portal. NOTE: this loader's requirePartnerAccount does
// NOT protect child routes (loaders run in parallel); every /partner route calls
// the guard itself.
export async function loader({ request }: Route.LoaderArgs) {
  const ctx = await requirePartnerAccount(request);
  const orgIds = ctx.memberships.map((m) => m.orgId);

  const me = await prisma.user.findUnique({
    where: { id: ctx.auth.user.sub },
    select: { photoUrl: true },
  });
  const avatarUrl = await resolvePhotoUrl(me?.photoUrl);

  // The account's projects across ALL memberships feed the Projects nav item.
  // A partner in more than one org over time gets a two-level org→project menu;
  // one org stays a flat list; one project a direct link; none hides the item.
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

  // Show the org name in the nav chip only when there is exactly one membership
  // (unambiguous). Multi-org and no-org accounts show nothing.
  const orgName =
    ctx.memberships.length === 1 ? ctx.memberships[0].org.name : null;

  return { user: ctx.auth.user, orgName, orgGroups, avatarUrl };
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium transition ${
    isActive ? "text-accent-coral" : "text-dark-blue hover:text-accent-coral"
  }`;

export default function PartnerLayout() {
  const { user, orgName, orgGroups, avatarUrl } = useLoaderData<typeof loader>();

  const displayName = user.firstName
    ? `${user.firstName} ${user.lastName ?? ""}`.trim()
    : user.email;

  return (
    <div className="min-h-screen bg-page">
      <nav className="fixed top-0 inset-x-0 z-50 h-16 bg-card border-b border-border flex items-center px-4 sm:px-6 gap-6">
        {/* The logo IS the home link — no separate Home item. */}
        <Link
          to="/partner"
          className="flex items-center min-w-0 focus:outline-none"
          title="DALI Partner Portal — home"
        >
          <img src="/logo-blue.svg" alt="DALI Lab" className="h-9 w-auto flex-shrink-0" />
        </Link>

        {/* Nav holds places, not actions — pitching lives on Home, where the
            partner's applications give it context. */}
        <div className="flex items-center gap-5">
          <ProjectsNav orgGroups={orgGroups} />
        </div>

        <PortalProfileMenu
          initials={userInitials(user)}
          displayName={displayName}
          subtitle={orgName}
          settingsTo="/partner/settings"
          avatarUrl={avatarUrl}
        />
      </nav>

      <div className="pt-16">
        <main className="w-full px-4 sm:px-6 lg:px-10 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

type OrgGroup = {
  orgId: string;
  orgName: string;
  projects: { id: string; name: string }[];
};

// One project → plain link straight to its hub; several in one org → flat
// dropdown; several across orgs → two-level org→project menu; none → nothing
// (pre-acceptance partners see just the logo and profile).
function ProjectsNav({ orgGroups }: { orgGroups: OrgGroup[] }) {
  const location = useLocation();
  const active = location.pathname.startsWith("/partner/projects");
  const allProjects = orgGroups.flatMap((g) => g.projects);

  if (allProjects.length === 0) return null;
  if (allProjects.length === 1) {
    return (
      <NavLink
        to={`/partner/projects/${allProjects[0].id}`}
        className={navLinkClass}
      >
        Projects
      </NavLink>
    );
  }

  const multiOrg = orgGroups.length > 1;

  return (
    <Menu
      align="left"
      ariaLabel="Projects"
      trigger={(open) => (
        <button
          type="button"
          className={`flex items-center gap-1 text-sm font-medium transition ${
            active ? "text-accent-coral" : "text-dark-blue hover:text-accent-coral"
          }`}
        >
          Projects
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      )}
    >
      {orgGroups.map((g) => (
        <div key={g.orgId}>
          {multiOrg && (
            <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
              {g.orgName}
            </div>
          )}
          {g.projects.map((p) => (
            <Menu.LinkItem
              key={p.id}
              to={`/partner/projects/${p.id}`}
              className="block px-4 py-2 text-sm text-dark-blue hover:bg-muted/50 transition truncate"
            >
              {p.name}
            </Menu.LinkItem>
          ))}
        </div>
      ))}
    </Menu>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <div className="min-h-screen bg-page">
      <nav className="fixed top-0 inset-x-0 z-50 h-16 bg-card border-b border-border flex items-center px-4 sm:px-6">
        <Link to="/partner" className="flex items-center gap-3 min-w-0">
          <img src="/logo-blue.svg" alt="DALI Lab" className="h-9 w-auto" />
        </Link>
      </nav>
      <div className="pt-16">
        <ApplicantErrorBoundary error={error} secondaryAction={{ kind: "reload" }} />
      </div>
    </div>
  );
}
