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
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { partnerProjectsWhere } from "~/partners/lib/partner-access";
import { userInitials } from "~/lib/display";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { PortalProfileMenu } from "~/components/PortalProfileMenu";
import { Menu } from "~/components/ui/floating";

// Partner portal chrome: fixed top navbar, no member sidebar — the same
// shape as the applicant portal. NOTE: this loader's requirePartner does NOT
// protect child routes (loaders run in parallel); every /partner route calls
// the guard itself.
export async function loader({ request }: Route.LoaderArgs) {
  const { auth, partnerUser, org } = await requirePartner(request);
  // The org's projects feed the Projects nav item: direct link for one,
  // dropdown for several, hidden for none (pre-acceptance partners).
  const projects = await prisma.project.findMany({
    where: partnerProjectsWhere(partnerUser.partnerOrgId),
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return { user: auth.user, orgName: org.name, projects };
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium transition ${
    isActive ? "text-accent-coral" : "text-dark-blue hover:text-accent-coral"
  }`;

export default function PartnerLayout() {
  const { user, orgName, projects } = useLoaderData<typeof loader>();

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
          <ProjectsNav projects={projects} />
        </div>

        <PortalProfileMenu
          initials={userInitials(user)}
          displayName={displayName}
          subtitle={orgName}
          settingsTo="/partner/settings"
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

// One project → plain link straight to its hub; several → dropdown by name;
// none → nothing (pre-acceptance partners see just the logo and profile).
function ProjectsNav({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const location = useLocation();
  const active = location.pathname.startsWith("/partner/projects");

  if (projects.length === 0) return null;
  if (projects.length === 1) {
    return (
      <NavLink to={`/partner/projects/${projects[0].id}`} className={navLinkClass}>
        Projects
      </NavLink>
    );
  }

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
      {projects.map((p) => (
        <Menu.LinkItem
          key={p.id}
          to={`/partner/projects/${p.id}`}
          className="block px-4 py-2 text-sm text-dark-blue hover:bg-muted/50 transition truncate"
        >
          {p.name}
        </Menu.LinkItem>
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
