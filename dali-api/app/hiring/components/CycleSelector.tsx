import { useSearchParams } from "react-router";
import { SegmentedTabButtons } from "~/components/AreaPillNav";

export function CycleSelector({
  cycles,
  activeId,
}: {
  cycles: Array<{ id: string; name: string }>;
  activeId: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  if (cycles.length < 2) return null;
  return (
    <SegmentedTabButtons
      label="Cycle"
      size="toolbar"
      items={cycles.map((c) => ({
        label: c.name,
        active: c.id === activeId,
        onClick: () => {
          const next = new URLSearchParams(searchParams);
          next.set("cycle", c.id);
          setSearchParams(next, { replace: true });
        },
      }))}
    />
  );
}
