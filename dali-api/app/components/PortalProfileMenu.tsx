import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ChevronDown } from "lucide-react";

// Shared open/close state for portal navbar dropdowns: closes on outside
// click or Escape.
export function useDismissableMenu() {
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

// The account menu the external portals (partner, applicant) hang off the
// profile chip: Settings lives here (not a nav tab) plus sign out. `subtitle`
// is the second identity line — org name for partners, email for applicants.
export function PortalProfileMenu({
  initials,
  displayName,
  subtitle,
  settingsTo,
  logoutTo = "/logout",
}: {
  initials: string;
  displayName: string;
  subtitle?: string | null;
  settingsTo: string;
  // Where sign-out lands. Partners pass "/logout?next=/partner/login" so they
  // return to their own portal, not the member /login.
  logoutTo?: string;
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
          {subtitle && (
            <span className="text-xs text-muted-foreground block truncate max-w-[200px]">
              {subtitle}
            </span>
          )}
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
            to={settingsTo}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-dark-blue hover:bg-muted/50 transition"
          >
            Settings
          </Link>
          <Link
            to={logoutTo}
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
