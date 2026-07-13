import { Outlet, redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/applicant-layout";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { userInitials } from "~/lib/display";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { PortalProfileMenu } from "~/components/PortalProfileMenu";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;
  return { user: auth.user };
}

export default function ApplicantLayout() {
  const { user } = useLoaderData<typeof loader>() as {
    user: { sub: string; email: string; type: string; firstName?: string; lastName?: string };
  };

  const displayName = user.firstName
    ? `${user.firstName} ${user.lastName ?? ""}`.trim()
    : user.email;

  const initial = userInitials(user);

  return (
    <div className="min-h-screen bg-page">
      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 h-16 bg-card border-b border-border flex items-center px-4 sm:px-6">
        <Link to="/portal" className="flex items-center min-w-0 focus:outline-none" title="DALI home">
          <img
            src="/logo-blue.svg"
            alt="DALI Lab"
            className="h-9 w-auto flex-shrink-0"
          />
        </Link>

        <div className="ml-6 flex items-center gap-4 text-sm font-medium">
          <Link to="/portal/hiring" className="text-dark-blue hover:text-accent-coral transition">
            Apply
          </Link>
          <Link to="/portal/education" className="text-dark-blue hover:text-accent-coral transition">
            Education
          </Link>
        </div>

        <PortalProfileMenu
          initials={initial}
          displayName={displayName}
          subtitle={user.email}
          settingsTo="/portal/settings"
        />
      </nav>

      {/* Content */}
      <div className="pt-16">
        <Outlet />
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // Layout-level boundary catches errors from this route's own loader
  // (e.g. requireAuth). Auth state is unknown here, so render a minimal
  // shell without the user-identity navbar to avoid misrepresenting it.
  return (
    <div className="min-h-screen bg-page">
      <nav className="fixed top-0 inset-x-0 z-50 h-16 bg-card border-b border-border flex items-center px-4 sm:px-6">
        <Link to="/portal" className="flex items-center min-w-0">
          <img
            src="/logo-blue.svg"
            alt="DALI Lab"
            className="h-9 w-auto flex-shrink-0"
          />
        </Link>
      </nav>
      <div className="pt-16">
        <ApplicantErrorBoundary error={error} secondaryAction={{ kind: "reload" }} />
      </div>
    </div>
  );
}
