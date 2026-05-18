import { NavLink } from "react-router";

interface Tab {
  to: string;
  label: string;
}

interface Props {
  offeringId: string;
  offeringTitle: string;
}

export function EducationTabs({ offeringId, offeringTitle }: Props) {
  const tabs: Tab[] = [
    { to: `/education/offerings/${offeringId}`, label: "Overview" },
    { to: `/education/offerings/${offeringId}/sessions`, label: "Sessions" },
    { to: `/education/offerings/${offeringId}/roster`, label: "Roster" },
    { to: `/education/offerings/${offeringId}/attendance`, label: "Attendance" },
    { to: `/education/offerings/${offeringId}/assignments`, label: "Assignments" },
    { to: `/education/offerings/${offeringId}/announcements`, label: "Announcements" },
    { to: `/education/offerings/${offeringId}/pages`, label: "Pages" },
    { to: `/education/offerings/${offeringId}/settings`, label: "Settings" },
  ];
  return (
    <div className="border-b border-border mb-6">
      <h1 className="font-heading text-2xl font-bold text-dark-blue px-1 mb-3">
        {offeringTitle}
      </h1>
      <nav className="flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.label === "Overview"}
            className={({ isActive }) =>
              `px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? "border-accent-coral text-dark-blue"
                  : "border-transparent text-muted-foreground hover:text-dark-blue"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
