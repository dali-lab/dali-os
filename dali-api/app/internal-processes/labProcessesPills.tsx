import { ArrowLeftRight, Briefcase, LayoutGrid } from "lucide-react";
import type { AreaPill } from "~/components/AreaPillNav";

// Lab Processes surfaces (the sidebar entry is childless and lands on the
// hub). Level Up lives under Projects → Staffing, not here. Onboarding lives
// under Hiring (hiringPills) — accepted-applicant provisioning, not a lab
// process.
export function labProcessesPills(args: {
  active: "hub" | "transfer" | "jobx";
}): AreaPill[] {
  return [
    {
      label: "Hub",
      to: "/internal-processes",
      active: args.active === "hub",
      icon: LayoutGrid,
    },
    {
      label: "Transfer",
      to: "/internal-processes/transfer",
      active: args.active === "transfer",
      icon: ArrowLeftRight,
    },
    {
      label: "JobX",
      to: "/internal-processes/jobx",
      active: args.active === "jobx",
      icon: Briefcase,
    },
  ];
}
