// What each board item looks like. Positioning, selection and dragging live in
// CanvasBoard; these only draw an item's face and its inline text editor.

import type { KeyboardEvent } from "react";
import { Check, ImageIcon } from "lucide-react";
import { cn } from "~/lib/cn";
import { STICKY_COLORS } from "~/journeys/lib/studio";
import type { CanvasItem, Hotspot } from "~/journeys/lib/studio-types";

export type CanvasPatch = Partial<Omit<CanvasItem, "id" | "type">> & { label?: string };

interface FaceProps {
  editing: boolean;
  editable: boolean;
  selected: boolean;
  onUpdate: (patch: CanvasPatch) => void;
  onStopEditing: () => void;
}

const stopOnEscape = (e: KeyboardEvent, stop: () => void) => {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    stop();
  }
};

const ring = (selected: boolean) => selected && "outline outline-2 outline-offset-2 outline-navy-deep";

function EditableText({
  text,
  editing,
  editable,
  placeholder,
  className,
  onUpdate,
  onStopEditing,
}: Omit<FaceProps, "selected"> & { text: string; placeholder: string; className: string }) {
  if (editing) {
    return (
      <textarea
        autoFocus
        value={text}
        aria-label="Text"
        placeholder={placeholder}
        onChange={(e) => onUpdate({ text: e.target.value })}
        onBlur={onStopEditing}
        onKeyDown={(e) => stopOnEscape(e, onStopEditing)}
        className={cn("resize-none bg-transparent outline-none placeholder:text-navy-deep/40", className)}
      />
    );
  }
  return (
    <p className={cn("whitespace-pre-wrap break-words", className, !text && "text-navy-deep/40")}>
      {text || (editable ? placeholder : "")}
    </p>
  );
}

export function StickyFace({ item, ...face }: FaceProps & { item: CanvasItem }) {
  return (
    <div
      className={cn("h-full w-full rounded-[3px] p-4 shadow-[0_2px_8px_rgba(8,35,48,0.18)]", ring(face.selected))}
      style={{ backgroundColor: STICKY_COLORS[item.color ?? "yellow"] }}
    >
      <EditableText {...face} text={item.text ?? ""} placeholder="Double-click to write" className="h-full w-full text-[15px] leading-snug text-navy-deep" />
    </div>
  );
}

export function TextFace({ item, ...face }: FaceProps & { item: CanvasItem }) {
  const text = item.text ?? "";
  return (
    <div className={cn("min-w-[60px] rounded px-1", ring(face.selected))}>
      {face.editing ? (
        <textarea
          autoFocus
          rows={Math.max(1, text.split("\n").length)}
          value={text}
          aria-label="Text"
          placeholder="Type a label"
          onChange={(e) => face.onUpdate({ text: e.target.value })}
          onBlur={face.onStopEditing}
          onKeyDown={(e) => stopOnEscape(e, face.onStopEditing)}
          className="w-[280px] resize-none bg-transparent text-xl font-semibold leading-tight text-navy-deep outline-none placeholder:text-navy-deep/40"
        />
      ) : (
        <p className={cn("max-w-[420px] whitespace-pre-wrap text-xl font-semibold leading-tight", text ? "text-navy-deep" : "text-navy-deep/40")}>
          {text || "Type a label"}
        </p>
      )}
    </div>
  );
}

export function ShapeFace({ item, ...face }: FaceProps & { item: CanvasItem }) {
  return (
    <div className={cn("grid h-full w-full place-items-center rounded-xl border-2 border-navy-deep bg-brand-white p-3 text-center", ring(face.selected))}>
      <EditableText {...face} text={item.text ?? ""} placeholder="Shape" className="w-full text-center text-sm text-navy-deep" />
    </div>
  );
}

export function ImageFace({ item, selected }: { item: CanvasItem; selected: boolean }) {
  return (
    <div className={cn("h-full w-full overflow-hidden rounded-md bg-brand-white shadow-[0_2px_10px_rgba(8,35,48,0.15)]", ring(selected))}>
      {item.src ? (
        <img src={item.src} alt={item.alt ?? ""} draggable={false} className="pointer-events-none h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-[#7b8a93]">
          <ImageIcon className="h-8 w-8" aria-hidden />
        </div>
      )}
    </div>
  );
}

export function PinFace({ item, pinNumber, ...face }: FaceProps & { item: CanvasItem; pinNumber?: number }) {
  const text = item.text ?? "";
  return (
    <div className="relative">
      <div
        className={cn(
          "grid h-7 w-7 place-items-center rounded-full rounded-bl-none bg-accent-coral text-xs font-bold text-navy-deep shadow-md ring-2",
          face.selected ? "ring-navy-deep" : "ring-brand-white",
        )}
        aria-label={pinNumber ? `Comment ${pinNumber}` : "Comment"}
      >
        {pinNumber ?? ""}
      </div>
      {(face.editing || text || face.selected) && (
        <div className="absolute left-9 top-0 w-56 rounded-lg bg-brand-white p-2.5 shadow-[0_4px_14px_rgba(8,35,48,0.18)]">
          <EditableText {...face} text={text} placeholder="What's the problem?" className="min-h-[3rem] w-full text-[13px] leading-snug text-navy-deep" />
        </div>
      )}
    </div>
  );
}

export function HotspotFace({
  hotspot,
  found,
  ...face
}: FaceProps & { hotspot: Hotspot; found?: boolean }) {
  return (
    <div
      className={cn(
        "relative h-full w-full rounded-md border-2 border-accent-teal",
        found ? "border-solid bg-accent-teal/25" : "border-dashed bg-accent-teal/10",
        ring(face.selected),
      )}
    >
      <div className="absolute left-1.5 top-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded bg-accent-teal px-1.5 py-0.5 text-[11px] font-semibold text-white">
        {found && <Check className="h-3 w-3 shrink-0" aria-label="Found" />}
        {face.editing ? (
          <input
            type="text"
            autoFocus
            value={hotspot.label}
            aria-label="Problem area name"
            placeholder="Name this problem"
            onChange={(e) => face.onUpdate({ label: e.target.value })}
            onBlur={face.onStopEditing}
            onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && face.onStopEditing()}
            className="w-40 bg-transparent text-white outline-none placeholder:text-white/70"
          />
        ) : (
          <span className="truncate">{hotspot.label || "Unnamed problem area"}</span>
        )}
      </div>
    </div>
  );
}
