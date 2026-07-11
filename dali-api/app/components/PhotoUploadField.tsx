import { useEffect, useRef, useState } from "react";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  fileMatchesAccept,
} from "~/lib/file-validation";
import { initialsFromName } from "~/lib/display";
import { PhotoCropModal } from "./PhotoCropModal";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

// Image-upload control: pick an image → crop/zoom modal → upload the cropped
// result to S3 → store the returned key in a hidden input (`fieldName`,
// default "photoUrl"). The surrounding form persists that key exactly as the
// old free-text field did; loaders presign it back to a URL for display (see
// resolvePhotoUrl). Defaults suit member profile photos; org logos etc. pass
// `label`/`fieldName`/`keyPrefix`.
export function PhotoUploadField({
  userId,
  name,
  initialKey,
  initialPreviewUrl,
  readOnly,
  label = "Profile photo",
  fieldName = "photoUrl",
  keyPrefix,
}: {
  userId: string;
  name: string;
  initialKey: string | null;
  initialPreviewUrl: string | null;
  readOnly: boolean;
  label?: string;
  fieldName?: string;
  keyPrefix?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState(initialKey ?? "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initialPreviewUrl ?? null,
  );
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Object URLs we created and are responsible for revoking.
  const previewBlobUrl = useRef<string | null>(null);
  const cropBlobUrl = useRef<string | null>(null);

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
          key: `${keyPrefix ?? `avatars/${userId}`}/${crypto.randomUUID()}.${ext}`,
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

      const newPreview = URL.createObjectURL(blob);
      if (previewBlobUrl.current) URL.revokeObjectURL(previewBlobUrl.current);
      previewBlobUrl.current = newPreview;
      setPreviewUrl(newPreview);
      setKey(uploadedKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleRemove() {
    setKey("");
    if (previewBlobUrl.current) {
      URL.revokeObjectURL(previewBlobUrl.current);
      previewBlobUrl.current = null;
    }
    setPreviewUrl(null);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 flex-shrink-0">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              className="w-20 h-20 rounded-lg object-cover border border-border"
            />
          ) : (
            <div className="w-20 h-20 rounded-lg border border-border bg-accent-coral/15 text-accent-coral flex items-center justify-center font-bold text-xl">
              {initialsFromName(name)}
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 rounded-lg bg-black/40 flex items-center justify-center">
              <span className="inline-block w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-60"
              >
                {previewUrl ? "Replace" : "Upload photo"}
              </button>
              {previewUrl && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={handleRemove}
                  className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              PNG, JPEG, WebP, or GIF · max {MAX_UPLOAD_LABEL}
            </p>
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
      <input type="hidden" name={fieldName} value={key} />

      {error && <p className="text-xs text-red-500">{error}</p>}

      <PhotoCropModal
        open={cropSrc !== null}
        imageSrc={cropSrc}
        onCancel={closeCrop}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
