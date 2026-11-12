import { type ProjectStatus } from "~/projects/lib/project-lifecycle";
import { STATUS_PILL_OS } from "~/projects/components/detail/constants";

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`rounded-full border px-3 py-[5px] text-xs font-semibold ${STATUS_PILL_OS[status]}`}>
      {status}
    </span>
  );
}
