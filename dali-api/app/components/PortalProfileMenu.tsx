import { ChevronDown } from "lucide-react";
import { Menu } from "~/components/ui/floating";

// The account menu the external portals (partner, applicant) hang off the
// profile chip: Settings lives here (not a nav tab) plus sign out. `subtitle`
// is the second identity line — org name for partners, email for applicants.
// `avatarUrl` is a resolved (presigned) photo URL; when absent we fall back to
// the initials monogram.
export function PortalProfileMenu({
  initials,
  displayName,
  subtitle,
  settingsTo,
  avatarUrl,
}: {
  initials: string;
  displayName: string;
  subtitle?: string | null;
  settingsTo: string;
  avatarUrl?: string | null;
}) {
  return (
    <div className="ml-auto">
      <Menu
        align="right"
        ariaLabel="Account"
        trigger={(open) => (
          <button
            type="button"
            title="Account"
            className="flex items-center gap-2 min-w-0 rounded-full py-1 pl-1 pr-2 hover:bg-muted/50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="w-8 h-8 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-accent-coral flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {initials}
              </div>
            )}
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
        )}
      >
        <Menu.LinkItem to={settingsTo}>Settings</Menu.LinkItem>
        <Menu.LinkItem to="/logout" muted>
          Sign out
        </Menu.LinkItem>
      </Menu>
    </div>
  );
}
