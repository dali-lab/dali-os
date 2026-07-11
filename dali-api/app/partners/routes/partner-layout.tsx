import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLoaderData, useRouteError } from "react-router";
import { ChevronDown } from "lucide-react";
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
