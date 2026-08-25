import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Camera } from "lucide-react";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  fileMatchesAccept,
} from "~/lib/file-validation";
import { initialsFromName } from "~/lib/display";
import { useInitialsTint } from "~/components/ui/Avatar";
import { cn } from "~/lib/cn";
import { PhotoCropModal } from "./PhotoCropModal";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

// Large profile avatar with an overlaid camera-icon upload button. Unlike
// PhotoUploadField (a row inside the Profile form), this stands alone in the
// page header: clicking the icon opens the file picker → crop modal → S3
// upload, then immediately persists the new key via a fetcher POST
// (intent=update-photo) — no "edit Profile → save" round-trip. The same key
// shape round-trips as the old field; loaders presign it for display.
export function ProfilePhotoAvatar({
  userId,
  name,
  initialPreviewUrl,
  canEdit,
}: {
  userId: string;
  name: string;
  initialPreviewUrl: string | null;
  canEdit: boolean;
}) {
  const fetcher = useFetcher();
  const fileRef = useRef<HTMLInputElement>(null);
  const tint = useInitialsTint();
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl ?? null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewBlobUrl = useRef<string | null>(null);
  const cropBlobUrl = useRef<string | null>(null);

  // Loader is the source of truth: when it returns a fresh presigned URL after
  // a save, adopt it (and drop any local blob preview).
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
          key: `avatars/${userId}/${crypto.randomUUID()}.${ext}`,
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
      formData.append("file", blob, `avatar.${ext}`);
      const uploadRes = await fetch(url, { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const body = await uploadRes.text().catch(() => "");
        if (uploadRes.status === 403 && /EntityTooLarge/i.test(body)) {
          throw new Error(`Image too large (max ${MAX_UPLOAD_LABEL})`);
        }
        throw new Error("Upload failed");
      }

      // Optimistic local preview while the fetcher saves + loader revalidates.
      const newPreview = URL.createObjectURL(blob);
      if (previewBlobUrl.current) URL.revokeObjectURL(previewBlobUrl.current);
      previewBlobUrl.current = newPreview;
      setPreviewUrl(newPreview);

      // Persist immediately — the page action's update-photo intent stores the key.
      fetcher.submit(
        { intent: "update-photo", photoUrl: uploadedKey },
        { method: "post" },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const busy = uploading || fetcher.state !== "idle";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-32 h-32">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="w-32 h-32 rounded-lg object-cover border border-border"
          />
        ) : (
          <div
            className={cn(
              "w-32 h-32 rounded-lg border border-border flex items-center justify-center font-bold text-3xl",
              tint,
            )}
          >
            {initialsFromName(name)}
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 rounded-lg bg-black/40 flex items-center justify-center">
            <span className="inline-block w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {canEdit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            aria-label={previewUrl ? "Replace profile photo" : "Upload profile photo"}
            title={previewUrl ? "Replace photo" : "Upload photo"}
            className="absolute -bottom-1.5 -right-1.5 w-9 h-9 rounded-full bg-accent-coral text-white border-2 border-card shadow-sm flex items-center justify-center hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
          >
            <Camera className="w-4 h-4" />
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        onChange={handleInputChange}
        className="hidden"
      />

      {error && <p className="text-xs text-red-500 max-w-[12rem] text-center">{error}</p>}

      <PhotoCropModal
        open={cropSrc !== null}
        imageSrc={cropSrc}
        onCancel={closeCrop}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
