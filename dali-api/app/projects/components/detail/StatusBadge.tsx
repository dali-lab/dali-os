import { Pill, type PillTone } from "~/components/ui/Pill";
import type { ProjectStatus } from "~/projects/lib/project-lifecycle";

export const PROJECT_STATUS_TONES: Record<ProjectStatus, PillTone> = {
  Active: "success",
  Paused: "warning",
  Archived: "neutral",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Pill dot={PROJECT_STATUS_TONES[status]} size="sm">
      {status}
    </Pill>
  );
}
