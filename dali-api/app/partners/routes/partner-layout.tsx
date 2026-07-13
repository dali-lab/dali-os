import { useEffect, useRef, useState } from "react";
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

        <ProfileMenu
          initials={userInitials(user)}
          displayName={displayName}
          orgName={orgName}
        />
      </nav>

      <div className="pt-16">
        <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// Shared open/close state for the navbar dropdowns: closes on outside click
// or Escape.
function useDismissableMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return { open, setOpen, ref };
}

// One project → plain link straight to its hub; several → dropdown by name;
// none → nothing (pre-acceptance partners just see Apply).
function ProjectsNav({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const { open, setOpen, ref } = useDismissableMenu();
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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 text-sm font-medium transition ${
          active ? "text-accent-coral" : "text-dark-blue hover:text-accent-coral"
        }`}
      >
        Projects
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-2 w-56 bg-card border border-border rounded-xl shadow-lg py-1 z-50"
        >
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/partner/projects/${p.id}`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-dark-blue hover:bg-muted/50 transition truncate"
            >
              {p.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Account menu behind the profile chip: Settings lives here (not a nav tab)
// plus sign out. Closes on outside click, Escape, or navigating.
function ProfileMenu({
  initials,
  displayName,
  orgName,
}: {
  initials: string;
  displayName: string;
  orgName: string;
}) {
  const { open, setOpen, ref } = useDismissableMenu();

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Account"
        className="flex items-center gap-2 min-w-0 rounded-full py-1 pl-1 pr-2 hover:bg-muted/50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral"
      >
        <div className="w-8 h-8 rounded-full bg-accent-coral flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="hidden sm:block min-w-0 text-left">
          <span className="text-sm font-medium text-dark-blue block truncate max-w-[200px]">
            {displayName}
          </span>
          <span className="text-xs text-muted-foreground block truncate max-w-[200px]">
            {orgName}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-xl shadow-lg py-1 z-50"
        >
          <Link
            to="/partner/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-dark-blue hover:bg-muted/50 transition"
          >
            Settings
          </Link>
          <Link
            to="/logout"
            role="menuitem"
            className="block px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition"
          >
            Sign out
          </Link>
        </div>
      )}
    </div>
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
