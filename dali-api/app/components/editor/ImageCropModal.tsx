import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Modal } from "~/components/Modal";

// Crop an editor image: drag/resize a rectangle over the image, then crop it on
// a <canvas> and hand the result (a File) back to the caller, which re-uploads
// it and swaps the node's src. Destructive by design — the cropped image is a
// plain <img src>, so it renders identically across the editor, the viewer,
// collab, and every export format with no per-surface work.
//
// The image is loaded through /api/upload/proxy (same-origin stream) rather than
// /api/upload/raw (which 302-redirects cross-origin to S3): a cross-origin image
// would taint the canvas and make toBlob() throw.

type Rect = { x: number; y: number; w: number; h: number };
type Corner = "nw" | "ne" | "sw" | "se";

const MAX_DISPLAY_W = 620;
const MIN_CROP = 24;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const CORNERS: { id: Corner; cursor: string; style: CSSProperties }[] = [
  { id: "nw", cursor: "nwse-resize", style: { left: -6, top: -6 } },
  { id: "ne", cursor: "nesw-resize", style: { right: -6, top: -6 } },
  { id: "sw", cursor: "nesw-resize", style: { left: -6, bottom: -6 } },
  { id: "se", cursor: "nwse-resize", style: { right: -6, bottom: -6 } },
];

function proxyUrl(src: string): string {
  return src.startsWith("/api/upload/raw")
    ? src.replace("/api/upload/raw", "/api/upload/proxy")
    : src;
}

export function ImageCropModal({
  src,
  onApply,
  onCancel,
}: {
  src: string;
  onApply: (file: File) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [display, setDisplay] = useState<{ w: number; h: number; scale: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const maxH = Math.round(window.innerHeight * 0.6);
      const scale = Math.min(
        MAX_DISPLAY_W / img.naturalWidth,
        maxH / img.naturalHeight,
        1,
      );
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      imgRef.current = img;
      setDisplay({ w, h, scale });
      setRect({ x: 0, y: 0, w, h });
    };
    img.onerror = () => {
      if (!cancelled) setError("Couldn't load the image to crop.");
    };
    img.src = proxyUrl(src);
    return () => {
      cancelled = true;
    };
  }, [src]);

  function startDrag(event: ReactPointerEvent, mode: Corner | "move") {
    event.preventDefault();
    event.stopPropagation();
    if (!rect || !display) return;
    const start = { ...rect };
    const startX = event.clientX;
    const startY = event.clientY;
    const bounds = display;

    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (mode === "move") {
        setRect({
          x: clamp(start.x + dx, 0, bounds.w - start.w),
          y: clamp(start.y + dy, 0, bounds.h - start.h),
          w: start.w,
          h: start.h,
        });
        return;
      }
      let x1 = start.x;
      let y1 = start.y;
      let x2 = start.x + start.w;
      let y2 = start.y + start.h;
      if (mode.includes("w")) x1 = clamp(start.x + dx, 0, x2 - MIN_CROP);
      if (mode.includes("e")) x2 = clamp(start.x + start.w + dx, x1 + MIN_CROP, bounds.w);
      if (mode.includes("n")) y1 = clamp(start.y + dy, 0, y2 - MIN_CROP);
      if (mode.includes("s")) y2 = clamp(start.y + start.h + dy, y1 + MIN_CROP, bounds.h);
      setRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  async function apply() {
    const img = imgRef.current;
    if (!img || !rect || !display) return;
    setApplying(true);
    setError(null);
    try {
      const { scale } = display;
      const sx = Math.round(rect.x / scale);
      const sy = Math.round(rect.y / scale);
      const sw = Math.max(1, Math.round(rect.w / scale));
      const sh = Math.max(1, Math.round(rect.h / scale));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("toBlob returned null");
      await onApply(new File([blob], "cropped.png", { type: "image/png" }));
    } catch (err) {
      console.error("[editor] image crop failed", err);
      setError("Couldn't crop this image.");
      setApplying(false);
    }
  }

  return (
    <Modal
      open
      onClose={onCancel}
      labelledBy="image-crop-title"
      disableEscape={applying}
      containerClassName="bg-card rounded-2xl shadow-brand-2 w-full max-w-2xl my-auto flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <h2 id="image-crop-title" className="font-heading text-base font-bold text-foreground">
          Crop image
        </h2>
        <span className="text-xs text-muted-foreground">Drag the box, then Apply</span>
      </div>

      <div className="flex items-center justify-center bg-muted/40 p-4">
        {display && rect ? (
          <div
            className="relative select-none overflow-hidden"
            style={{ width: display.w, height: display.h, touchAction: "none" }}
          >
            <img
              src={proxyUrl(src)}
              alt=""
              draggable={false}
              className="pointer-events-none block h-full w-full"
            />
            <div
              className="absolute cursor-move border border-white/90"
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
              }}
              onPointerDown={(e) => startDrag(e, "move")}
            >
              {CORNERS.map((c) => (
                <span
                  key={c.id}
                  onPointerDown={(e) => startDrag(e, c.id)}
                  className="absolute h-3 w-3 rounded-sm border border-gray-500 bg-white"
                  style={{ ...c.style, cursor: c.cursor }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="py-16 text-sm text-muted-foreground">{error ?? "Loading…"}</div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
        <span className="text-xs text-destructive">{display ? error : ""}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={applying || !rect}
            className="rounded-md bg-accent-coral px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {applying ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
