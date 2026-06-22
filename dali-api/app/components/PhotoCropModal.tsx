import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Modal, ModalHeader } from "./Modal";

const OUTPUT_SIZE = 512;

// Draw the selected square region of `imageSrc` onto a fixed-size canvas and
// return it as a normalized image blob. `area` is in natural-image pixels, as
// react-easy-crop reports it. WebP keeps avatars small; PNG is the fallback for
// the rare browser whose canvas can't encode WebP.
async function getCroppedBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image");

  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  );

  const blob = await canvasToBlob(canvas, "image/webp");
  if (blob) return blob;
  const pngBlob = await canvasToBlob(canvas, "image/png");
  if (pngBlob) return pngBlob;
  throw new Error("Could not process image");
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
}: {
  open: boolean;
  imageSrc: string | null;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setArea(areaPixels);
  }, []);

  async function handleConfirm() {
    if (!imageSrc || !area) return;
    setError(null);
    setProcessing(true);
    try {
      const blob = await getCroppedBlob(imageSrc, area);
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
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-md w-full p-5 sm:p-6 my-auto"
    >
      <ModalHeader
        titleId="photo-crop-title"
        title="Adjust photo"
        onClose={onCancel}
        hideClose={processing}
        className="mb-3"
      />

      <div className="relative w-full h-72 bg-black rounded-lg overflow-hidden">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      <label className="flex items-center gap-3 mt-4 text-xs text-muted-foreground">
        Zoom
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="flex-1 accent-accent-coral"
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
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
        >
          {processing ? "Processing…" : "Confirm"}
        </button>
      </div>
    </Modal>
  );
}
