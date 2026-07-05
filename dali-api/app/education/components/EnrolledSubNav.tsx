import { NavLink } from "react-router";

const tabs = [
  { label: "Sessions", to: "." },
  { label: "Assignments", to: "assignments" },
  { label: "Announcements", to: "announcements" },
  { label: "Discussions", to: "discussions" },
  { label: "Grades", to: "grades" },
] as const;

/**
 * Left-rail sub-nav for the enrolled view. Uses relative NavLinks so it works
 * identically inside both the member layout (/education/enrolled/:id) and the
 * portal layout (/portal/education/:id/enrolled).
 *
 * On narrow screens the nav collapses to a horizontally-scrollable tab strip.
 * On md+ it becomes a vertical left-rail.
 */
export function EnrolledSubNav() {
  return (
    <nav className="flex flex-row md:flex-col md:w-44 md:shrink-0 overflow-x-auto md:overflow-x-visible border-b md:border-b-0 md:border-r border-border md:pt-4 md:pb-4">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "."}
          relative="path"
          className={({ isActive }) =>
            [
              "block py-2 px-3 text-sm transition-colors whitespace-nowrap",
              isActive
                ? "text-dark-blue font-semibold border-b-2 md:border-b-0 md:border-l-2 border-accent-coral"
                : "text-muted-foreground hover:text-dark-blue",
            ].join(" ")
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
