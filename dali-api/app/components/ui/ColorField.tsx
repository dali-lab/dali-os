import { useEffect, useState } from "react";
import { Popover } from "~/components/ui/floating";
import { cn } from "~/lib/cn";

export const COLOR_PRESETS = ["#1c2b4a", "#000000", "#444444", "#888888", "#ffffff", "#b3261e", "#c2410c", "#a16207", "#15803d", "#0e7490", "#1d4ed8", "#7e22ce"] as const;

const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeHex(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  const full = /^#?[0-9a-f]{3}$/.test(v) ? v.replace("#", "").replace(/./g, (c) => c + c) : v.replace("#", "");
  const hex = `#${full}`;
  return HEX.test(hex) ? hex : null;
}

export function ColorField({
  value,
  onChange,
  label = "Color",
  className,
}: {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  className?: string;
}) {
  return (
    <Popover
      ariaLabel={label}
      trigger={
        <button
          type="button"
          aria-label={label}
          className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md border border-os-container p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent", className)}
        >
          <span className="h-full w-full rounded-[3px] border border-os-container" style={{ backgroundColor: value }} />
        </button>
      }
    >
      {(close) => <ColorPanel value={value} onChange={onChange} onDone={close} />}
    </Popover>
  );
}

function ColorPanel({ value, onChange, onDone }: { value: string; onChange: (hex: string) => void; onDone: () => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const hex = normalizeHex(draft);
    if (!hex) return setDraft(value);
    if (hex !== value.toLowerCase()) onChange(hex);
  };
  return (
    <div className="flex w-48 flex-col gap-2">
      <div className="grid grid-cols-6 gap-1.5">
        {COLOR_PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={hex}
            aria-pressed={hex === value.toLowerCase()}
            onClick={() => {
              onChange(hex);
              onDone();
            }}
            className={cn("h-6 w-6 rounded-md border border-os-container", hex === value.toLowerCase() && "ring-2 ring-os-accent")}
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          aria-label="Hex color"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.preventDefault(), commit());
            else if (e.key === "Escape") setDraft(value);
          }}
          className="min-w-0 flex-1 rounded-lg border border-os-container bg-transparent px-2 py-1 text-sm tabular-nums text-foreground focus:border-os-accent focus:outline-none"
        />
        <input
          type="color"
          aria-label="Pick a color"
          value={HEX.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-8 shrink-0 cursor-pointer rounded border border-os-container bg-transparent p-0.5"
        />
      </div>
    </div>
  );
}
