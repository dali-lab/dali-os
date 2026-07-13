import type { AreaPill } from "~/components/AreaPillNav";

// Lab Processes surfaces (the sidebar entry is childless and lands on the
// hub). Level Up lives under Projects → Staffing, not here.
export function labProcessesPills(args: {
  isCore: boolean;
  active: "hub" | "onboarding" | "transfer" | "jobx";
}): AreaPill[] {
  return [
    { label: "Hub", to: "/internal-processes", active: args.active === "hub" },
    ...(args.isCore
      ? [
          {
            label: "Onboarding",
            to: "/internal-processes/onboarding",
            active: args.active === "onboarding",
          },
        ]
      : []),
    {
      label: "Transfer",
      to: "/internal-processes/transfer",
      active: args.active === "transfer",
    },
    { label: "JobX", to: "/internal-processes/jobx", active: args.active === "jobx" },
  ];
}
