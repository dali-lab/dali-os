import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import type { ModuleStatus } from "~/journeys/lib/types";

const STATUS = {
  completed: { label: "Completed", dot: "success" },
  available: { label: "Ready to start", dot: "accent" },
  locked: { label: "Locked", dot: "neutral" },
} as const;

export function StatusChip({ status }: { status: ModuleStatus }) {
  const { label, dot } = STATUS[status];
  return <Pill dot={dot}>{label}</Pill>;
}
