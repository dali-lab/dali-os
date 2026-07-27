import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Camera, Trash2 } from "lucide-react";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  fileMatchesAccept,
} from "~/lib/file-validation";
import { PhotoCropModal } from "~/components/PhotoCropModal";
import { useDialog } from "~/components/ui/dialog";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

// Banner crop ratio. Sits between the detail page's wide hero box and the
// hub card's shorter thumbnail; both use object-cover, so each trims a little
// rather than either letterboxing.
const BANNER_ASPECT = 3;

// Full-width project banner that doubles as the image-upload control. When the
// project has no image, a default gradient (with the project initial) shows
// instead. Clicking the banner (or its camera button) picks → crops → uploads
// to S3 → saves immediately via the page action's update-image intent. No
// "edit details → save" round-trip. Mirrors members' ProfilePhotoAvatar.
export function ProjectImageBanner({
  projectId,
  projectName,
  initialPreviewUrl,
  canEdit,
}: {
  projectId: string;
  projectName: string;
  initialPreviewUrl: string | null;
  canEdit: boolean;
}) {
  const dialog = useDialog();
  const fetcher = useFetcher();
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl ?? null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewBlobUrl = useRef<string | null>(null);
  const cropBlobUrl = useRef<string | null>(null);

  // Loader is source of truth after a save.
  useEffect(() => {
    setPreviewUrl(initialPreviewUrl ?? null);
  }, [initialPreviewUrl]);

  useEffect(
    () => () => {
      if (previewBlobUrl.current) URL.revokeObjectURL(previewBlobUrl.current);
      if (cropBlobUrl.current) URL.revokeObjectURL(cropBlobUrl.current);
    },
    [],
  );

  function clearFileInput() {
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`Image too large (max ${MAX_UPLOAD_LABEL})`);
      clearFileInput();
      return;
    }
    if (!fileMatchesAccept(file.name, file.type, ACCEPT)) {
      setError("Please choose an image (PNG, JPEG, WebP, or GIF).");
      clearFileInput();
      return;
    }
    const url = URL.createObjectURL(file);
    if (cropBlobUrl.current) URL.revokeObjectURL(cropBlobUrl.current);
    cropBlobUrl.current = url;
    setCropSrc(url);
    clearFileInput();
  }

  function closeCrop() {
    if (cropBlobUrl.current) {
      URL.revokeObjectURL(cropBlobUrl.current);
      cropBlobUrl.current = null;
    }
    setCropSrc(null);
  }

  async function handleConfirm(blob: Blob) {
    closeCrop();
    setUploading(true);
    setError(null);
    try {
      const ext = blob.type === "image/png" ? "png" : "webp";
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `project-images/${projectId}/${crypto.randomUUID()}.${ext}`,
          contentType: blob.type || "image/webp",
          contentLength: blob.size,
          accept: ACCEPT,
        }),
      });
      if (!presignRes.ok) {
        const text = await presignRes.text();
        let message = "Failed to get upload URL";
        try {
          message = JSON.parse(text).error ?? message;
        } catch {}
        throw new Error(message);
      }
      const { url, fields, key: uploadedKey } = await presignRes.json();

      const formData = new FormData();
      for (const [n, v] of Object.entries(fields as Record<string, string>)) {
        formData.append(n, v);
      }
      formData.append("file", blob, `image.${ext}`);
      const uploadRes = await fetch(url, { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const body = await uploadRes.text().catch(() => "");
        if (uploadRes.status === 403 && /EntityTooLarge/i.test(body)) {
          throw new Error(`Image too large (max ${MAX_UPLOAD_LABEL})`);
        }
        throw new Error("Upload failed");
      }

      const newPreview = URL.createObjectURL(blob);
      if (previewBlobUrl.current) URL.revokeObjectURL(previewBlobUrl.current);
      previewBlobUrl.current = newPreview;
      setPreviewUrl(newPreview);

      fetcher.submit(
        { intent: "update-image", imageUrl: uploadedKey },
        { method: "post" },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    if (
      !(await dialog.confirm({
        title: "Remove the project image?",
        description: "The default banner will show instead.",
        confirmLabel: "Remove",
        tone: "destructive",
      }))
    ) {
      return;
    }
    setError(null);
    if (previewBlobUrl.current) {
      URL.revokeObjectURL(previewBlobUrl.current);
      previewBlobUrl.current = null;
    }
    setPreviewUrl(null);
    // The page action treats an empty imageUrl as "clear to null".
    fetcher.submit({ intent: "update-image", imageUrl: "" }, { method: "post" });
  }

  const busy = uploading || fetcher.state !== "idle";
  const initial = projectName.trim().charAt(0).toUpperCase() || "?";

  const clickable = canEdit && !busy;

  return (
    <div className="flex flex-col gap-1">
      {/* The action pills are siblings of the banner button (a button can't
          nest a button), overlaid via this relative wrapper. */}
      <div className="relative group">
        <button
          type="button"
          disabled={!clickable}
          onClick={() => fileRef.current?.click()}
          aria-label={previewUrl ? "Replace project image" : "Upload project image"}
          className={`relative block w-full h-48 rounded-lg overflow-hidden border border-border ${
            clickable ? "cursor-pointer" : "cursor-default"
          }`}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            // Default banner: deterministic gradient + project initial.
            <div className="w-full h-full bg-gradient-to-br from-accent-coral/30 via-accent-coral/15 to-accent-green/20 flex items-center justify-center">
              <span className="font-heading font-bold text-5xl text-accent-coral/70">
                {initial}
              </span>
            </div>
          )}

          {busy && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="inline-block w-7 h-7 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            </div>
          )}

          {canEdit && !busy && (
            /* Hover hint over the whole banner. */
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" />
          )}
        </button>

        {canEdit && !busy && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md bg-black/55 hover:bg-black/70 text-white text-xs font-medium px-2.5 py-1.5 opacity-90 transition-colors"
            >
              <Camera className="w-4 h-4" />
              {previewUrl ? "Replace image" : "Upload image"}
            </button>
            {previewUrl && (
              <button
                type="button"
                onClick={handleRemove}
                aria-label="Remove project image"
                className="inline-flex items-center gap-1.5 rounded-md bg-black/55 hover:bg-black/70 text-white text-xs font-medium px-2.5 py-1.5 opacity-90 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Remove
              </button>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        onChange={handleInputChange}
        className="hidden"
      />

      {error && <p className="text-xs text-red-500">{error}</p>}

      <PhotoCropModal
        open={cropSrc !== null}
        imageSrc={cropSrc}
        onCancel={closeCrop}
        onConfirm={handleConfirm}
        aspect={BANNER_ASPECT}
        cropShape="rect"
      />
    </div>
  );
}
