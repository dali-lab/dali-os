import { Pill } from "~/admin/components/console-ui";
import { gapPill } from "../../lib/planning-gap";

export function GapPill({ gap }: { gap: number }) {
  const { tone, label } = gapPill(gap);
  return <Pill tone={tone}>{label}</Pill>;
}
