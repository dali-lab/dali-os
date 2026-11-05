import { LAYOUTS, STAGE_H, STAGE_W, type LayoutDef } from "~/components/slides/deck/layouts";
import { cn } from "~/lib/cn";

/** A layout drawn as boxes: text as bars, the image as a filled block. */
export function LayoutGlyph({ layout }: { layout: LayoutDef }) {
  return (
    <span className="relative block aspect-video w-full overflow-hidden rounded-[3px] bg-os-well" aria-hidden>
      {layout.slots.map((s) => (
        <span
          key={s.slot}
          className={cn("absolute rounded-[1px]", s.kind === "image" ? "bg-os-muted/50" : "bg-os-muted")}
          style={{
            left: `${(s.rect.x / STAGE_W) * 100}%`,
            top: `${(s.rect.y / STAGE_H) * 100}%`,
            width: `${(s.rect.w / STAGE_W) * 100}%`,
            height: `${Math.min((s.rect.h / STAGE_H) * 100, s.kind === "image" ? 100 : 16)}%`,
          }}
        />
      ))}
    </span>
  );
}

export function LayoutGrid({ value, onPick }: { value?: string; onPick: (layoutId: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Layouts">
      {LAYOUTS.map((layout) => (
        <button
          key={layout.id}
          type="button"
          onClick={() => onPick(layout.id)}
          aria-pressed={value === layout.id}
          className={cn(
            "flex flex-col gap-1.5 rounded-lg border p-1.5 text-left text-xs transition-colors",
            value === layout.id ? "border-os-accent bg-os-hover" : "border-os-container hover:bg-os-hover",
          )}
        >
          <LayoutGlyph layout={layout} />
          <span className="px-0.5 text-os-grey">{layout.name}</span>
        </button>
      ))}
    </div>
  );
}
