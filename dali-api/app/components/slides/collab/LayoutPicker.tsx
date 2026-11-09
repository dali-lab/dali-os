import { LAYOUTS, STAGE_H, STAGE_W, type LayoutDef } from "~/components/slides/deck/layouts";
import { ScaledSlide } from "~/components/slides/deck/SlideRender";
import { Modal, ModalHeader } from "~/components/Modal";
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

/** A layout drawn the way a slide using it looks in the deck's theme, with hints in the empty boxes. */
export function LayoutThumb({ layout, themeId }: { layout: LayoutDef; themeId: string }) {
  return (
    <span className="block overflow-hidden rounded-[3px]" data-layout-thumb={layout.id}>
      <ScaledSlide slide={{ id: layout.id, pos: 0, layoutId: layout.id, elements: [] }} theme={themeId} placeholders className="pointer-events-none" />
    </span>
  );
}

export function LayoutGrid({ value, onPick, themeId, columns = 2 }: { value?: string; onPick: (layoutId: string) => void; themeId?: string; columns?: 2 | 3 }) {
  return (
    <div className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-2")} role="group" aria-label="Layouts">
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
          {themeId ? <LayoutThumb layout={layout} themeId={themeId} /> : <LayoutGlyph layout={layout} />}
          <span className="px-0.5 text-os-grey">{layout.name}</span>
        </button>
      ))}
    </div>
  );
}

export function LayoutGalleryModal({ title, themeId, value, onPick, onClose }: { title: string; themeId: string; value?: string; onPick: (layoutId: string) => void; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} labelledBy="slide-layouts-title" containerClassName="w-full max-w-3xl rounded-os-card bg-os-card p-5 shadow-xl">
      <ModalHeader titleId="slide-layouts-title" title={title} onClose={onClose} className="mb-3" />
      <div className="max-h-[70vh] overflow-y-auto">
        <LayoutGrid value={value} themeId={themeId} columns={3} onPick={onPick} />
      </div>
    </Modal>
  );
}
