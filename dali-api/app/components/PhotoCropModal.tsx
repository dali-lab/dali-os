import { useCallback, useEffect, useState } from "react";
import { buttonClasses } from "~/components/ui/Button";
import Cropper, { type Area } from "react-easy-crop";
import { Modal, ModalHeader } from "./Modal";
import { modalCardClass } from "~/components/os-chrome";
import { edgeColors, fitBackdrop, fitLayout, fitZoom, type EdgeColors } from "./crop-fit";

const DEFAULT_OUTPUT_SHORT_SIDE = 512;

// Short side is the output's short edge; the long side follows `aspect`.
export async function getCroppedBlob(
  imageSrc: string,
  area: Area,
  aspect: number,
  shortSide = DEFAULT_OUTPUT_SHORT_SIDE,
  fill?: EdgeColors,
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  const width =
    aspect >= 1 ? Math.round(shortSide * aspect) : shortSide;
  const height =
    aspect >= 1 ? shortSide : Math.round(shortSide / aspect);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image");

  const layout = fitLayout(area, image.naturalWidth, image.naturalHeight, width, height);
  if (fill) {
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const band = layout.bands[side];
      if (!band) continue;
      ctx.fillStyle = fill[side];
      ctx.fillRect(band.x, band.y, band.width, band.height);
    }
  }
  ctx.drawImage(image, layout.image.x, layout.image.y, layout.image.width, layout.image.height);

  const blob = await canvasToBlob(canvas, "image/webp");
  if (blob) return blob;
  const pngBlob = await canvasToBlob(canvas, "image/png");
  if (pngBlob) return pngBlob;
  throw new Error("Could not process image");
}

async function sampleEdgeColors(src: string): Promise<EdgeColors | null> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, 64, 64);
  return edgeColors(ctx.getImageData(0, 0, 64, 64).data, 64, 64);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () => reject(new Error("Could not load image")));
    img.src = src;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
}

export function PhotoCropModal({
  open,
  imageSrc,
  onCancel,
  onConfirm,
  aspect = 1,
  cropShape = "round",
  title = "Adjust photo",
  outputShortSide = DEFAULT_OUTPUT_SHORT_SIDE,
  fit = false,
}: {
  open: boolean;
  imageSrc: string | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
  /** Crop box width:height. Defaults to the square avatar crop. */
  aspect?: number;
  cropShape?: "round" | "rect";
  title?: string;
  /** Short edge of the saved image in pixels. */
  outputShortSide?: number;
  /** Lets the image zoom out to fit whole, filling the leftover space with its edge colors. */
  fit?: boolean;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minZoom, setMinZoom] = useState(1);
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const [fill, setFill] = useState<EdgeColors | null>(null);

  useEffect(() => {
    setFill(null);
    if (!fit || !imageSrc) return;
    let cancelled = false;
    sampleEdgeColors(imageSrc)
      .then((c) => !cancelled && setFill(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fit, imageSrc]);

  const onMediaLoaded = useCallback(
    ({ naturalWidth, naturalHeight }: { naturalWidth: number; naturalHeight: number }) => {
      if (!fit) return;
      const z = Math.min(1, fitZoom(naturalWidth, naturalHeight, aspect));
      setImageAspect(naturalWidth / naturalHeight);
      setMinZoom(z);
      setZoom(z);
      setCrop({ x: 0, y: 0 });
    },
    [fit, aspect],
  );

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setArea(areaPixels);
  }, []);

  async function handleConfirm() {
    if (!imageSrc || !area) return;
    setError(null);
    setProcessing(true);
    try {
      const blob = await getCroppedBlob(imageSrc, area, aspect, outputShortSide, fit ? (fill ?? undefined) : undefined);
      onConfirm(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process image");
    } finally {
      setProcessing(false);
    }
  }

  if (!open || !imageSrc) return null;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      labelledBy="photo-crop-title"
      disableEscape={processing}
      containerClassName={modalCardClass("max-w-md")}
    >
      <ModalHeader
        titleId="photo-crop-title"
        title={title}
        onClose={onCancel}
        hideClose={processing}
        className="mb-3"
      />

      <div className="relative w-full h-72 bg-black rounded-lg overflow-hidden">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          cropShape={cropShape}
          showGrid={false}
          minZoom={minZoom}
          restrictPosition={!fit}
          onMediaLoaded={onMediaLoaded}
          style={
            fit && fill && imageAspect
              ? { containerStyle: { background: fitBackdrop(fill, imageAspect, aspect) } }
              : {}
          }
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      <label className="flex items-center gap-3 mt-4 text-xs text-muted-foreground">
        Zoom
        <input
          type="range"
          min={minZoom}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="flex-1 accent-os-accent"
        />
      </label>

      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

      <div className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={processing}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={processing || !area}
          className={buttonClasses("primary", "sm")}
        >
          {processing ? "Processing…" : "Confirm"}
        </button>
      </div>
    </Modal>
  );
}
