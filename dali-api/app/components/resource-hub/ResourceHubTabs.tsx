import { NavLink } from "react-router";

const TAB =
  "rounded-lg px-4 py-2 text-lg transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60";

/** Resources | Crit Wall | References, for hubs that belong to a domain. Switching replaces the entry, which the layout treats as an in-place update, so the scroll position and the tabs stay where they were. */
export function ResourceHubTabs({ pageId, className = "" }: { pageId: string; className?: string }) {
  const tabs = [
    { to: `/resource-hub/${pageId}`, label: "Resources", end: true },
    { to: `/resource-hub/${pageId}/crit`, label: "Crit Wall", end: false },
    { to: `/resource-hub/${pageId}/references`, label: "References", end: false },
  ];
  return (
    <nav aria-label="Hub sections" className={`flex items-center gap-1 ${className}`}>
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          replace
          preventScrollReset
          className={({ isActive }) =>
            `${TAB} ${isActive ? "bg-os-accent/10 font-medium text-foreground" : "text-os-grey hover:bg-os-hover hover:text-foreground"}`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
