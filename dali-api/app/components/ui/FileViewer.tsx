import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { cn } from "~/lib/cn";
import { IconButton } from "./IconButton";
import { Tooltip } from "./floating";
import { Z } from "./z";
import { FIT, MAX_SCALE, MIN_SCALE, ZOOM_STEP, panBy, toggleZoom, wheelFactor, zoomBy, type Point, type ZoomState } from "./zoom";

export type ViewerFile = {
  id: string;
  title: string;
  kind: "image" | "pdf";
  src: string | null;
  href?: string | null;
};

type Props = {
  files: ViewerFile[];
  index: number;
  onIndexChange: (index: number) => void;
  open: boolean;
  onClose: () => void;
};

export function FileViewer({ files, index, onIndexChange, open, onClose }: Props) {
  const titleId = useId();
  const file = files[Math.min(index, files.length - 1)];
  const [zoom, setZoom] = useState<ZoomState>(FIT);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const zoomable = file?.kind === "image" && Boolean(file.src);

  useEffect(() => setZoom(FIT), [file?.id, open]);

  const fromCenter = useCallback((clientX: number, clientY: number): Point => {
    const rect = stage?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }, [stage]);

  const go = useCallback(
    (step: number) => {
      const next = index + step;
      if (next >= 0 && next < files.length) onIndexChange(next);
    },
    [index, files.length, onIndexChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (!zoomable) return;
      else if (e.key === "+" || e.key === "=") setZoom((z) => zoomBy(z, ZOOM_STEP));
      else if (e.key === "-") setZoom((z) => zoomBy(z, 1 / ZOOM_STEP));
      else if (e.key === "0") setZoom(FIT);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, go, zoomable]);

  useEffect(() => {
    if (!stage || !zoomable) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = fromCenter(e.clientX, e.clientY);
      setZoom((z) => (e.ctrlKey || z.scale === MIN_SCALE ? zoomBy(z, wheelFactor(e.deltaY, e.ctrlKey), at) : panBy(z, -e.deltaX, -e.deltaY)));
    };
    let gestureStart = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStart = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as Event & { scale: number }).scale;
      const factor = scale / gestureStart;
      gestureStart = scale;
      setZoom((z) => zoomBy(z, factor));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("gesturestart", onGestureStart);
    stage.addEventListener("gesturechange", onGestureChange);
    return () => {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("gesturestart", onGestureStart);
      stage.removeEventListener("gesturechange", onGestureChange);
    };
  }, [stage, zoomable, fromCenter]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!zoomable) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const others = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    if (others.length === 1) {
      const [other] = others;
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 0) setZoom((z) => zoomBy(z, after / before, fromCenter((next.x + other.x) / 2, (next.y + other.y) / 2)));
      return;
    }
    setZoom((z) => panBy(z, next.x - prev.x, next.y - prev.y));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  if (!file) return null;

  const controls = (
    <>
      {files.length > 1 && (
        <>
          <IconButton label="Previous" icon={ChevronLeft} disabled={index === 0} onClick={() => go(-1)} />
          <span className="text-sm tabular-nums text-os-grey">
            {index + 1} of {files.length}
          </span>
          <IconButton label="Next" icon={ChevronRight} disabled={index === files.length - 1} onClick={() => go(1)} />
        </>
      )}
      {zoomable && (
        <>
          <IconButton label="Zoom out" shortcut="-" icon={ZoomOut} disabled={zoom.scale <= MIN_SCALE} onClick={() => setZoom((z) => zoomBy(z, 1 / ZOOM_STEP))} />
          <span className="w-12 text-center text-sm tabular-nums text-os-grey" aria-live="polite">
            {Math.round(zoom.scale * 100)}%
          </span>
          <IconButton label="Zoom in" shortcut="+" icon={ZoomIn} disabled={zoom.scale >= MAX_SCALE} onClick={() => setZoom((z) => zoomBy(z, ZOOM_STEP))} />
          <IconButton label="Fit" shortcut="0" icon={Maximize} disabled={zoom.scale === MIN_SCALE} onClick={() => setZoom(FIT)} />
        </>
      )}
      {file.href && (
        <Tooltip content="Open in a new tab">
          <a href={file.href} target="_blank" rel="noreferrer" aria-label="Open in a new tab" className="os-icon-btn">
            <ExternalLink className="h-5 w-5" aria-hidden />
          </a>
        </Tooltip>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      className={`fixed inset-0 ${Z.modal} flex bg-os-overlay p-4 sm:p-6`}
      containerClassName="os-modal-card flex min-h-0 w-full flex-col"
    >
      <ModalHeader titleId={titleId} title={file.title} onClose={onClose} actions={controls} className="mb-3" />
      <div
        ref={setStage}
        data-testid="file-viewer-stage"
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-os-card bg-os-well",
          zoomable && "touch-none",
          zoomable && (zoom.scale > MIN_SCALE ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"),
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => zoomable && setZoom((z) => toggleZoom(z, fromCenter(e.clientX, e.clientY)))}
      >
        {!file.src ? (
          <p className="text-sm text-os-grey">Preview isn't available right now.</p>
        ) : file.kind === "pdf" ? (
          <iframe src={file.src} title={file.title} className="h-full w-full" />
        ) : (
          <img
            src={file.src}
            alt={file.title}
            draggable={false}
            className={cn("max-h-full max-w-full select-none object-contain", !dragging && "transition-transform duration-100")}
            style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}
          />
        )}
      </div>
    </Modal>
  );
}
