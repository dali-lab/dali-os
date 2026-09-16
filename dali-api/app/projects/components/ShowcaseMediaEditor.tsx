import { useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { Film, Loader2, Plus, X } from "lucide-react";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  fileMatchesAccept,
} from "~/lib/file-validation";

// Public media gallery editor. Images and short videos upload straight to the
// same S3 the hero banner uses (presign → direct POST), scoped under uploads/
// so the public media proxy will serve them. Structure-only, like the detail
// list: dali.website lays the gallery out.
//
// Uploads stage a row into local state; "Save media" persists the list as
// parallel repeated fields (mediaType / mediaSrc / mediaCaption), zipped back
// by index on the server. An upload you don't save is a harmless orphan in the
// bucket, so the hint says to save.

const ACCEPT_IMAGE = "image/png,image/jpeg,image/webp,image/gif";
const ACCEPT_VIDEO = "video/mp4,video/quicktime,video/webm";
const ACCEPT = `${ACCEPT_IMAGE},${ACCEPT_VIDEO}`;

type MediaRow = {
  key: number;
  type: "image" | "video";
  src: string;
  caption: string;
  previewUrl: string | null;
};

export function ShowcaseMediaEditor({
  projectId,
  media,
  canEdit,
}: {
  projectId: string;
  media: { type: "image" | "video"; src: string; caption?: string; previewUrl: string | null }[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<MediaRow[]>(
    media.map((m, i) => ({
      key: i,
      type: m.type,
      src: m.src,
      caption: m.caption ?? "",
      previewUrl: m.previewUrl,
    })),
  );
  const [nextKey, setNextKey] = useState(media.length);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigation = useNavigation();
  const saving =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "showcase-media";

  function clearInput() {
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File too large (max ${MAX_UPLOAD_LABEL}).`);
      clearInput();
      return;
    }
    if (!fileMatchesAccept(file.name, file.type, ACCEPT)) {
      setError("Choose an image (PNG, JPEG, WebP, GIF) or video (MP4, MOV, WebM).");
      clearInput();
      return;
    }
    const isVideo = file.type.startsWith("video/");
    setUploading(true);
    try {
      const ext = file.name.includes(".")
        ? file.name.slice(file.name.lastIndexOf(".") + 1)
        : isVideo
          ? "mp4"
          : "bin";
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `project-images/${projectId}/media/${crypto.randomUUID()}.${ext}`,
          contentType: file.type || (isVideo ? "video/mp4" : "application/octet-stream"),
          contentLength: file.size,
          accept: ACCEPT,
        }),
      });
      if (!presignRes.ok) {
        let message = "Failed to get upload URL";
        try {
          message = (await presignRes.json()).error ?? message;
        } catch {}
        throw new Error(message);
      }
      const { url, fields, key } = await presignRes.json();
      const formData = new FormData();
      for (const [n, v] of Object.entries(fields as Record<string, string>)) {
        formData.append(n, v);
      }
      formData.append("file", file);
      const uploadRes = await fetch(url, { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const body = await uploadRes.text().catch(() => "");
        if (uploadRes.status === 403 && /EntityTooLarge/i.test(body)) {
          throw new Error(`File too large (max ${MAX_UPLOAD_LABEL}).`);
        }
        throw new Error("Upload failed");
      }
      setRows((prev) => [
        ...prev,
        {
          key: nextKey,
          type: isVideo ? "video" : "image",
          src: key,
          caption: "",
          previewUrl: URL.createObjectURL(file),
        },
      ]);
      setNextKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      clearInput();
    }
  }

  return (
    <Form method="post" className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="showcase-media" />

      {rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map((row, i) => (
            <div
              key={row.key}
              className="relative flex flex-col gap-2 rounded-lg border border-border bg-card p-2"
            >
              <input type="hidden" name="mediaType" value={row.type} />
              <input type="hidden" name="mediaSrc" value={row.src} />
              <div className="relative overflow-hidden rounded-md bg-muted aspect-video">
                {row.previewUrl ? (
                  row.type === "video" ? (
                    <video
                      src={row.previewUrl}
                      controls
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <img
                      src={row.previewUrl}
                      alt={row.caption || "Project media"}
                      className="h-full w-full object-cover"
                    />
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Film className="h-6 w-6" />
                  </div>
                )}
                {canEdit && (
                  <button
                    type="button"
                    aria-label="Remove media"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    className="absolute right-1.5 top-1.5 inline-flex items-center justify-center rounded-md bg-black/55 p-1 text-white hover:bg-black/70"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <input
                name="mediaCaption"
                defaultValue={row.caption}
                placeholder="Caption (optional)"
                disabled={!canEdit}
                aria-label="Media caption"
                className="w-full bg-transparent text-xs text-muted-foreground border border-transparent rounded px-1 hover:border-dashed hover:border-border focus:outline-none focus:border-solid focus:border-accent-coral/60 focus:bg-background transition-colors disabled:hover:border-transparent"
              />
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground italic px-1">
          No media yet.
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        onChange={handleFile}
        className="hidden"
      />

      {error && <p className="text-xs text-red-500">{error}</p>}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-solid disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {uploading ? "Uploading…" : "Add image or video"}
          </button>
          <button
            type="submit"
            disabled={saving || uploading}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save media"}
          </button>
          <span className="text-xs text-muted-foreground">
            Up to {MAX_UPLOAD_LABEL} each. Save to publish your uploads.
          </span>
        </div>
      )}
    </Form>
  );
}
