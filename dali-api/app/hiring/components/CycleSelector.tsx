import { useSearchParams } from "react-router";
import { Select, type SelectOption } from "~/components/ui/floating";
import { CYCLE_TYPE_LABELS } from "~/hiring/lib/internal-cycles";
import { STATUS_LABELS } from "~/hiring/lib/labels";

export { CYCLE_TYPE_LABELS };

export type CycleSelectorCycle = {
  id: string;
  name: string;
  cycleType: string;
  /** Latest ApplicationCycleStatus. Omitted where the caller only ever offers
   *  live cycles, in which case the option carries its type alone. */
  status?: string | null;
};

/**
 * Switches which cycle a hiring surface is showing, via `?cycle=<id>`.
 *
 * Named by cycle, not by cycle type: the segmented type pills this replaced
 * could only tell a Standard cycle from a Fellowship one running beside it, so
 * a page offering past cycles as well rendered a row of identical "Standard
 * hire" buttons. The name is the thing that distinguishes them, and the type
 * and status ride along as the option's description.
 */
export function CycleSelector({
  cycles,
  activeId,
}: {
  cycles: CycleSelectorCycle[];
  activeId: string | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Render whenever there is a cycle you are not already on. `cycles.length < 2`
  // would be wrong on a surface with no cycle selected at all (a domain whose
  // cycles have all completed), where a single past cycle is still a choice.
  if (cycles.every((c) => c.id === activeId)) return null;

  const options: SelectOption[] = cycles.map((c) => ({
    value: c.id,
    label: c.name,
    description: [
      CYCLE_TYPE_LABELS[c.cycleType as keyof typeof CYCLE_TYPE_LABELS] ?? c.cycleType,
      c.status ? (STATUS_LABELS[c.status] ?? c.status) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  return (
    <Select
      value={activeId ?? undefined}
      options={options}
      ariaLabel="Cycle"
      placeholder="Select a cycle"
      onChange={(id) => {
        const next = new URLSearchParams(searchParams);
        next.set("cycle", id);
        setSearchParams(next, { replace: true });
      }}
      buttonClassName="text-xs py-1"
    />
  );
}
