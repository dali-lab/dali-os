import { Link } from "react-router";

// Two-tab strip shared by the milestone Sets gallery and the Assign surface.
export function MilestonesSubnav({ active }: { active: "sets" | "assign" }) {
  const tab = (key: "sets" | "assign", label: string, to: string) => (
    <Link
      to={to}
      prefetch="intent"
      className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
        active === key
          ? "bg-accent-coral text-white"
          : "text-foreground/70 hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-full bg-muted p-[3px]">
      {tab("sets", "Sets", "/core/milestones")}
      {tab("assign", "Assign to projects", "/core/milestones/assign")}
    </div>
  );
}
