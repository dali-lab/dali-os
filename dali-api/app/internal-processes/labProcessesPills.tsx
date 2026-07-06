import type { AreaPill } from "~/components/AreaPillNav";

// Lab Processes surfaces (the sidebar entry is childless and lands on
// Transfer). Level Up lives under Projects → Staffing, not here.
export function labProcessesPills(args: {
  isCore: boolean;
  active: "onboarding" | "transfer" | "jobx";
}): AreaPill[] {
  return [
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
