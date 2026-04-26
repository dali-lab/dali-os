import { useEffect } from "react";
import { Outlet, redirect, useLoaderData, Link, useNavigate } from "react-router";
import type { Route } from "./+types/applicant-layout";
import { requireAuth } from "~/lib/auth";
import { userInitials } from "~/lib/display";
import { bumpLogoClick, hydrateRetroClass, logConsoleBootBanner } from "~/lib/party";

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

  const navigate = useNavigate();

  useEffect(() => {
    hydrateRetroClass();
    logConsoleBootBanner();
  }, []);

  const handleLogoClick = () => {
    const count = bumpLogoClick();
    if (count !== 0) navigate("/portal");
  };

  return (
    <div className="min-h-screen bg-section-bg">
      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 h-16 bg-card border-b border-border flex items-center px-6">
        <button
          type="button"
          onClick={handleLogoClick}
          className="flex items-center gap-2 focus:outline-none"
          title="DALI"
        >
          <span className="font-heading text-lg font-bold text-dark-blue">DALI</span>
          <span className="text-xs text-muted-foreground/70 font-medium">
            Applicant Portal
            <span className="group ml-1 inline-block cursor-help align-middle">
              <span className="text-xs text-muted-foreground/30 group-hover:hidden">·</span>
              <span className="hidden text-xs font-mono text-accent-coral group-hover:inline">2 = √16</span>
            </span>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-accent-coral flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {initial}
            </div>
            <span className="text-sm font-medium text-dark-blue hidden sm:block">
              {displayName}
            </span>
          </div>
          <Link
            to="/logout"
            className="text-xs text-muted-foreground hover:text-accent-coral transition"
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
