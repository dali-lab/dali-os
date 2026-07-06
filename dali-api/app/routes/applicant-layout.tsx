import { Outlet, redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/applicant-layout";
import { requireAuth } from "~/lib/auth";
import { userInitials } from "~/lib/display";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
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
        <Link to="/portal" className="flex items-center gap-3 min-w-0 focus:outline-none" title="DALI">
          <img
            src="/logo-blue.svg"
            alt="DALI Lab"
            className="h-9 w-auto flex-shrink-0"
          />
          <span className="text-xs text-muted-foreground/70 font-medium hidden sm:inline border-l border-border pl-3">
            Applicant Portal
          </span>
        </Link>

        <div className="ml-6 flex items-center gap-4 text-sm font-medium">
          <Link to="/portal" className="text-dark-blue hover:text-accent-coral transition">
            Home
          </Link>
          <Link to="/portal/hiring" className="text-dark-blue hover:text-accent-coral transition">
            Apply
          </Link>
          <Link to="/portal/education" className="text-dark-blue hover:text-accent-coral transition">
            Education
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-accent-coral flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {initial}
            </div>
            <span className="text-sm font-medium text-dark-blue hidden sm:block truncate max-w-[200px]">
              {displayName}
            </span>
          </div>
          <Link
            to="/logout"
            className="text-xs text-muted-foreground hover:text-accent-coral transition whitespace-nowrap"
          >
            Sign out
          </Link>
        </div>
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
        <Link to="/portal" className="flex items-center gap-3 min-w-0">
          <img
            src="/logo-blue.svg"
            alt="DALI Lab"
            className="h-9 w-auto flex-shrink-0"
          />
          <span className="text-xs text-muted-foreground/70 font-medium hidden sm:inline border-l border-border pl-3">Applicant Portal</span>
        </Link>
      </nav>
      <div className="pt-16">
        <ApplicantErrorBoundary error={error} secondaryAction={{ kind: "reload" }} />
      </div>
    </div>
  );
}
