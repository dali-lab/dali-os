import { Link, NavLink, Outlet, useLoaderData, useRouteError } from "react-router";
import type { Route } from "./+types/partner-layout";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { userInitials } from "~/lib/display";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";

// Partner portal chrome: fixed top navbar, no member sidebar — the same
// shape as the applicant portal. NOTE: this loader's requirePartner does NOT
// protect child routes (loaders run in parallel); every /partner route calls
// the guard itself.
export async function loader({ request }: Route.LoaderArgs) {
  const { auth, org } = await requirePartner(request);
  return { user: auth.user, orgName: org.name };
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium transition ${
    isActive ? "text-accent-coral" : "text-dark-blue hover:text-accent-coral"
  }`;

export default function PartnerLayout() {
  const { user, orgName } = useLoaderData<typeof loader>();

  const displayName = user.firstName
    ? `${user.firstName} ${user.lastName ?? ""}`.trim()
    : user.email;

  return (
    <div className="min-h-screen bg-page">
      <nav className="fixed top-0 inset-x-0 z-50 h-16 bg-card border-b border-border flex items-center px-4 sm:px-6 gap-6">
        <Link
          to="/partner"
          className="flex items-center gap-3 min-w-0 focus:outline-none"
          title="DALI Partner Portal"
        >
          <img src="/logo-blue.svg" alt="DALI Lab" className="h-9 w-auto flex-shrink-0" />
          <span className="text-xs text-muted-foreground/70 font-medium hidden sm:inline border-l border-border pl-3">
            Partner Portal
          </span>
        </Link>

        <div className="flex items-center gap-5">
          <NavLink to="/partner" end className={navLinkClass}>
            Home
          </NavLink>
          <NavLink to="/partner/apply" className={navLinkClass}>
            Apply
          </NavLink>
          <NavLink to="/partner/settings" className={navLinkClass}>
            Settings
          </NavLink>
        </div>

        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-accent-coral flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {userInitials(user)}
            </div>
            <div className="hidden sm:block min-w-0">
              <span className="text-sm font-medium text-dark-blue block truncate max-w-[200px]">
                {displayName}
              </span>
              <span className="text-xs text-muted-foreground block truncate max-w-[200px]">
                {orgName}
              </span>
            </div>
          </div>
          <Link
            to="/logout"
            className="text-xs text-muted-foreground hover:text-accent-coral transition whitespace-nowrap"
          >
            Sign out
          </Link>
        </div>
      </nav>

      <div className="pt-16">
        <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          <Outlet />
        </main>
      </div>
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
