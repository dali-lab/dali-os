import { Fragment, useRef, useState } from "react";
import { ImageIcon, MapPin, MousePointer2, Square, StickyNote, Target, Type, Upload, type LucideIcon } from "lucide-react";
import { IMAGE_UPLOAD_ACCEPT, uploadEditorImage } from "~/components/doc";
import { buttonClasses } from "~/components/ui/Button";
import { Tooltip } from "~/components/ui/floating/Tooltip";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { STICKY_COLORS } from "~/journeys/lib/studio";
import type { StickyColor } from "~/journeys/lib/studio-types";
import { toolAllowed, type BoardMode, type CanvasTool } from "./canvas-geometry";

export const PANEL = "rounded-os-card border border-os-container bg-os-card shadow-[0_8px_24px_var(--color-os-shadow)]";

const TOOLS: { id: CanvasTool; label: string; key: string; icon: LucideIcon }[] = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2 },
  { id: "sticky", label: "Sticky note", key: "S", icon: StickyNote },
  { id: "text", label: "Text", key: "T", icon: Type },
  { id: "shape", label: "Shape", key: "R", icon: Square },
  { id: "pin", label: "Comment pin", key: "P", icon: MapPin },
  { id: "image", label: "Image", key: "I", icon: ImageIcon },
  { id: "hotspot", label: "Hidden problem area", key: "H", icon: Target },
];

export function ColorSwatches({ value, onChange }: { value?: StickyColor; onChange: (c: StickyColor) => void }) {
  return (
    <>
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${c} sticky`}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn(
            "h-6 w-6 rounded-full ring-2 transition-[box-shadow]",
            value === c ? "ring-foreground" : "ring-transparent hover:ring-os-container-hi",
          )}
          style={{ backgroundColor: STICKY_COLORS[c] }}
        />
      ))}
    </>
  );
}

function ImageForm({ onAdd }: { onAdd: (src: string, alt: string) => void }) {
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const upload = async (file: File) => {
    setUploading(true);
    try {
      setSrc(await uploadEditorImage(file));
    } catch {
      toast.error("That image didn't upload. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form
      className={cn(PANEL, "os-form pointer-events-auto flex w-full max-w-lg items-center gap-2 p-2")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!src.trim()) return;
        onAdd(src.trim(), alt.trim());
        setSrc("");
        setAlt("");
      }}
    >
      <input type="text" autoFocus aria-label="Image URL" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Image URL" className="min-w-0 flex-1" />
      <input type="text" aria-label="Description" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Description" className="w-32" />
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      <Tooltip content="Upload an image">
        <button type="button" aria-label="Upload an image" disabled={uploading} onClick={() => fileRef.current?.click()} className={buttonClasses("ghost", "sm")}>
          <Upload className="h-4 w-4" aria-hidden />
        </button>
      </Tooltip>
      <button type="submit" disabled={!src.trim() || uploading} className={buttonClasses("primary", "sm")}>
        Add
      </button>
    </form>
  );
}

export function CanvasToolbar({
  tool,
  onTool,
  stickyColor,
  onStickyColor,
  mode,
  onAddImage,
}: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  stickyColor: StickyColor;
  onStickyColor: (color: StickyColor) => void;
  mode: BoardMode;
  onAddImage: (src: string, alt: string) => void;
}) {
  const visible = TOOLS.filter((t) => toolAllowed(t.id, mode));
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 px-4" data-board-controls>
      {tool === "sticky" && (
        <div className={cn(PANEL, "pointer-events-auto flex items-center gap-1.5 p-1.5")} role="group" aria-label="Sticky color">
          <ColorSwatches value={stickyColor} onChange={onStickyColor} />
        </div>
      )}
      {tool === "image" && <ImageForm onAdd={onAddImage} />}
      <div role="toolbar" aria-label="Board tools" className={cn(PANEL, "pointer-events-auto flex items-center gap-0.5 p-1.5")}>
        {visible.map(({ id, label, key, icon: Icon }, i) => (
          <Fragment key={id}>
            {!toolAllowed(id, "learner") && toolAllowed(visible[i - 1]?.id ?? "select", "learner") && (
              <span className="mx-1 h-6 w-px bg-os-container" aria-hidden />
            )}
            <Tooltip content={`${label} · ${key}`} placement="top">
              <button
                type="button"
                aria-label={`${label} (${key})`}
                aria-pressed={tool === id}
                onClick={() => onTool(id)}
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-os-item transition-colors",
                  tool === id ? "bg-os-accent text-os-bg" : "text-os-grey hover:bg-os-hover-strong hover:text-foreground",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
