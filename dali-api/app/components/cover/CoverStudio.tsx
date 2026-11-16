import { useRef, useState, type ReactNode } from "react";
import { ImagePlus } from "lucide-react";
import { modalCardClass } from "~/components/os-chrome";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { CARD_COLORS, COVER_PATTERNS, CoverTile, buildCoverUrl, cardColorHex, parseCover } from "./CoverPattern";

const DEFAULT_COVER = buildCoverUrl(COVER_PATTERNS[0]!.id);

export function CoverStudio({
  busy,
  heading,
  subtitle = "Pick a style, a card color, or upload an image.",
  submitLabel,
  initialCover,
  onClose,
  onSubmit,
  uploadImage,
  imageSrc = (value) => value,
  preview,
  children,
  serverError,
}: {
  busy: boolean;
  heading: string;
  subtitle?: string;
  submitLabel: string;
  initialCover: string | null;
  onClose: () => void;
  onSubmit: (cover: string) => void;
  uploadImage?: (file: File) => Promise<string>;
  imageSrc?: (cover: string) => string;
  preview?: (cover: string) => ReactNode;
  children?: ReactNode;
  serverError?: string | null;
}) {
  const [cover, setCover] = useState(initialCover ?? DEFAULT_COVER);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = parseCover(cover);
  const working = busy || uploading;
  const submit = () => !working && onSubmit(cover);

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="cover-studio-title"
      disableEscape={working}
      containerClassName={modalCardClass("max-w-4xl")}
    >
      <ModalHeader titleId="cover-studio-title" title={heading} subtitle={subtitle} onClose={onClose} className="!mb-4" />
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="overflow-hidden rounded-os-item border border-os-container">
            {preview ? (
              preview(cover)
            ) : parsed ? (
              <div className="aspect-[8/3] w-full" style={{ backgroundColor: cardColorHex(parsed.card) }}>
                <CoverTile url={cover} />
              </div>
            ) : cover ? (
              <img src={imageSrc(cover)} alt="" className="aspect-[8/3] w-full object-cover" />
            ) : (
              <div className="aspect-[8/3] w-full bg-os-well" />
            )}
          </div>
          {children}
          {serverError && <p role="alert" className="mt-3 text-sm text-destructive">{serverError}</p>}
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Style</p>
          <div className="grid grid-cols-3 gap-3">
            {COVER_PATTERNS.map((pt) => {
              const selected = parsed?.id === pt.id;
              const url = buildCoverUrl(pt.id, parsed?.card);
              return (
                <button
                  key={pt.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCover(url)}
                  className="group/thumb flex flex-col gap-1 text-left focus-visible:outline-none"
                >
                  <span
                    style={{ backgroundColor: cardColorHex(parsed?.card) }}
                    className={`block overflow-hidden rounded-lg border p-1.5 transition-shadow group-hover/thumb:shadow-md group-focus-visible/thumb:ring-2 group-focus-visible/thumb:ring-os-accent/60 ${selected ? "border-os-accent ring-1 ring-os-accent" : "border-os-container"}`}
                  >
                    <span className="block aspect-[5/6] overflow-hidden rounded-md">
                      <CoverTile url={url} />
                    </span>
                  </span>
                  <span className="text-xs text-os-grey">{pt.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mb-2 mt-3 text-sm font-semibold text-foreground">Card color</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Card color">
        {CARD_COLORS.map((c) => {
          const on = parsed?.card === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.name}
              title={parsed ? c.name : "Pick a style first"}
              disabled={!parsed}
              onClick={() => parsed && setCover(buildCoverUrl(parsed.id, c.id))}
              style={{ backgroundColor: c.hex }}
              className={`h-6 w-6 rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60 disabled:opacity-40 ${on ? "ring-2 ring-os-accent ring-offset-2 ring-offset-os-card" : ""}`}
            />
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-os-container pt-3">
        {uploadImage && (
          <button
            type="button"
            disabled={working}
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-os-hover disabled:opacity-60"
          >
            <ImagePlus className="h-4 w-4 text-os-grey" aria-hidden />
            {uploading ? "Uploading" : "Upload an image"}
          </button>
        )}
        {cover && (
          <button
            type="button"
            disabled={working}
            onClick={() => setCover("")}
            className="ml-auto rounded-lg border border-os-container px-3 py-1 text-sm text-foreground hover:bg-os-hover disabled:opacity-60"
          >
            Remove cover
          </button>
        )}
        {uploadError && <span role="alert" className="text-xs text-destructive">Upload failed.</span>}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          aria-label="Upload an image"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file || !uploadImage) return;
            setUploading(true);
            setUploadError(false);
            try {
              setCover(await uploadImage(file));
            } catch {
              setUploadError(true);
            } finally {
              setUploading(false);
            }
          }}
        />
      </div>
      <ModalFooter onCancel={onClose} cancelDisabled={working} className="!mt-4">
        <button type="button" disabled={working} onClick={submit} className="os-btn-primary os-btn-primary--sm">
          {submitLabel}
        </button>
      </ModalFooter>
    </Modal>
  );
}
