import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "~/lib/cn";
import { Button } from "~/components/ui/Button";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import {
  RESIZE_HANDLES,
  moveRect,
  rectFromPoints,
  resizeRect,
  scaleRect,
  type Point,
  type Rect,
  type ResizeHandle,
} from "~/lib/screenshot-selection";

/**
 * One frame of the current tab, or null when the browser can't share it (the
 * desktop app's webview, phones) or the user declines the prompt. Must be
 * called from a click: browsers only show the share prompt on a user gesture.
 */
export async function captureTabFrame(): Promise<HTMLCanvasElement | null> {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!media?.getDisplayMedia) return null;
  let stream: MediaStream;
  try {
    stream = await media.getDisplayMedia({
      video: { displaySurface: "browser" },
      audio: false,
      // Chromium hints, absent from lib.dom: offer this tab rather than a picker.
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions);
  } catch {
    return null;
  }
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // The first frames can still show the share prompt fading out.
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (!video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return canvas;
  } catch {
    return null;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

const HANDLE_POSITION: Record<ResizeHandle, string> = {
  nw: "left-0 top-0 cursor-nwse-resize",
  n: "left-1/2 top-0 cursor-ns-resize",
  ne: "left-full top-0 cursor-nesw-resize",
  e: "left-full top-1/2 cursor-ew-resize",
  se: "left-full top-full cursor-nwse-resize",
  s: "left-1/2 top-full cursor-ns-resize",
  sw: "left-0 top-full cursor-nesw-resize",
  w: "left-0 top-1/2 cursor-ew-resize",
};

const MIN_DRAWN = 4;

type Drag =
  | { mode: "new"; anchor: Point }
  | { mode: "move"; from: Point; rect: Rect }
  | { mode: "resize"; handle: ResizeHandle; from: Point; rect: Rect };

/**
 * The frozen frame, full screen, with a drag-to-select box over it: drag to
 * draw, drag the box to move it, drag a handle to resize. Enter captures.
 */
export function ScreenshotSelector({
  frame,
  onCapture,
  onSkip,
  onCancel,
}: {
  frame: HTMLCanvasElement;
  onCapture: (image: Blob) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    frame.toBlob((blob) => {
      if (!blob || cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    }, "image/png");
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [frame]);

  const ready = selection !== null && selection.width >= MIN_DRAWN && selection.height >= MIN_DRAWN;

  function capture() {
    const stage = stageRef.current;
    if (!stage || !selection || !ready) return;
    const crop = scaleRect(
      selection,
      { width: stage.clientWidth, height: stage.clientHeight },
      { width: frame.width, height: frame.height },
    );
    const out = document.createElement("canvas");
    out.width = crop.width;
    out.height = crop.height;
    out
      .getContext("2d")
      ?.drawImage(frame, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    out.toBlob((blob) => {
      if (blob) onCapture(blob);
    }, "image/png");
  }

  // Latest handlers for the key listener, which subscribes once.
  const keysRef = useRef({ capture, onCancel });
  keysRef.current = { capture, onCancel };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        keysRef.current.onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        keysRef.current.capture();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  function pointIn(e: React.PointerEvent): { point: Point; bounds: { width: number; height: number } } {
    const box = stageRef.current!.getBoundingClientRect();
    return {
      point: { x: e.clientX - box.left, y: e.clientY - box.top },
      bounds: { width: box.width, height: box.height },
    };
  }

  function begin(e: React.PointerEvent, drag: (from: Point) => Drag) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    stageRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = drag(pointIn(e).point);
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const { point, bounds } = pointIn(e);
    if (drag.mode === "new") {
      setSelection(rectFromPoints(drag.anchor, point, bounds));
      return;
    }
    const dx = point.x - drag.from.x;
    const dy = point.y - drag.from.y;
    setSelection(
      drag.mode === "move"
        ? moveRect(drag.rect, dx, dy, bounds)
        : resizeRect(drag.rect, drag.handle, dx, dy, bounds),
    );
  }

  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
    // A click without a drag clears the box rather than leaving a speck.
    setSelection((s) => (s && s.width >= MIN_DRAWN && s.height >= MIN_DRAWN ? s : null));
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Select a screenshot area"
      className="fixed inset-0 z-[100] flex select-none items-center justify-center bg-black"
    >
      {src && (
        <div
          ref={stageRef}
          className="relative cursor-crosshair touch-none overflow-hidden"
          onPointerDown={(e) => begin(e, (anchor) => ({ mode: "new", anchor }))}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img src={src} alt="" draggable={false} className="block max-h-dvh max-w-[100vw]" />
          {selection ? (
            <div
              className="absolute cursor-move border border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              style={{
                left: selection.x,
                top: selection.y,
                width: selection.width,
                height: selection.height,
              }}
              onPointerDown={(e) =>
                begin(e, (from) => ({ mode: "move", from, rect: selection }))
              }
            >
              {ready &&
                RESIZE_HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className={cn(
                      "absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40 bg-white",
                      HANDLE_POSITION[handle],
                    )}
                    onPointerDown={(e) =>
                      begin(e, (from) => ({ mode: "resize", handle, from, rect: selection }))
                    }
                  />
                ))}
              {ready && (
                <span className="absolute left-0 top-full mt-1.5 whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] text-white">
                  {Math.round(selection.width)} × {Math.round(selection.height)}
                </span>
              )}
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-0 bg-black/40" />
          )}
        </div>
      )}
      {/* Out of the way while a drag is in progress, so it never blocks the area being selected. */}
      <div
        className={cn(
          OS_SURFACE_CLASS,
          "absolute bottom-6 left-1/2 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 p-2 pl-4 transition-opacity",
          dragging && "pointer-events-none opacity-0",
        )}
      >
        <span className="text-sm text-os-grey">
          {ready ? "Drag to adjust" : "Drag to select an area"}
        </span>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={onSkip}>
          Skip screenshot
        </Button>
        <Button onClick={capture} disabled={!ready}>
          Capture
        </Button>
      </div>
    </div>,
    document.body,
  );
}
