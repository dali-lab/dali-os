import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import type { AlignMode } from "~/components/slides/deck/geometry";

const ALIGN: Array<{ mode: AlignMode; label: string; icon: typeof AlignStartVertical }> = [
  { mode: "left", label: "Align left", icon: AlignStartVertical },
  { mode: "center", label: "Align center", icon: AlignCenterVertical },
  { mode: "right", label: "Align right", icon: AlignEndVertical },
  { mode: "top", label: "Align top", icon: AlignStartHorizontal },
  { mode: "middle", label: "Align middle", icon: AlignCenterHorizontal },
  { mode: "bottom", label: "Align bottom", icon: AlignEndHorizontal },
];

export function AlignRow({ onAlign, disabled = false }: { onAlign: (mode: AlignMode) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Align" className="flex gap-0.5">
      {ALIGN.map(({ mode, label, icon }) => (
        <IconButton key={mode} label={label} icon={icon} disabled={disabled} onClick={() => onAlign(mode)} />
      ))}
    </div>
  );
}
