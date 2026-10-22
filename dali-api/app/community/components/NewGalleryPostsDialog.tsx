import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { cn } from "~/lib/cn";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { IconButton } from "~/components/ui/IconButton";
import { useToast } from "~/components/ui/toast";
import { uploadFileToS3 } from "~/lib/upload-client";
import { runPool } from "~/lib/run-pool";
import { MAX_CONCURRENT_UPLOADS } from "~/lib/upload-batch";
import { fileMatchesAccept } from "~/lib/file-validation";
import {
  GALLERY_ACCEPT,
  GALLERY_CAPTION_MAX,
  GALLERY_MAX_PHOTOS,
  galleryKeyPrefix,
  type NewGalleryPost,
} from "~/community/lib/gallery";

type Row = {
  id: string;
  name: string;
  previewUrl: string;
  caption: string;
  status: "uploading" | "ready" | "failed";
  error?: string;
  upload?: Omit<NewGalleryPost, "caption">;
};

// Size and average colour, read before upload so the feed can reserve the
// tile's shape and paint it while the image loads.
async function probeImage(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx?.drawImage(bitmap, 0, 0, 1, 1);
    const [r, g, b] = ctx?.getImageData(0, 0, 1, 1).data ?? [128, 128, 128];
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return { width: bitmap.width, height: bitmap.height, color: `#${hex(r)}${hex(g)}${hex(b)}` };
  } finally {
    bitmap.close();
  }
}

/** Bulk upload: one row per photo, each with its own caption, and "Post N" makes N posts. */
export function NewGalleryPostsDialog({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fetcher = useFetcher<{ ok: boolean; error?: string; created?: number }>();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => () => rowsRef.current.forEach((r) => URL.revokeObjectURL(r.previewUrl)), []);

  const done = fetcher.state === "idle" && fetcher.data;
  useEffect(() => {
    if (!done || !fetcher.data) return;
    if (fetcher.data.ok) {
      const n = fetcher.data.created ?? 0;
      toast.success(n === 1 ? "Posted." : `Posted ${n} photos.`);
      onClose();
    } else {
      setNotice(fetcher.data.error ?? "Couldn't post. Try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const patch = (id: string, next: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...next } : r)));

  async function addFiles(list: FileList | File[]) {
    setNotice(null);
    const images = Array.from(list).filter((f) => fileMatchesAccept(f.name, f.type, GALLERY_ACCEPT));
    const room = GALLERY_MAX_PHOTOS - rowsRef.current.length;
    const taken = images.slice(0, Math.max(0, room));
    if (images.length < Array.from(list).length) setNotice("Only photos (PNG, JPEG, WebP or GIF) can be posted.");
    if (taken.length < images.length) setNotice(`Up to ${GALLERY_MAX_PHOTOS} photos at a time.`);
    const added = taken.map((file) => ({
      file,
      row: {
        id: crypto.randomUUID(),
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        caption: "",
        status: "uploading" as const,
      },
    }));
    setRows((rs) => [...rs, ...added.map((a) => a.row)]);
    await runPool(added, MAX_CONCURRENT_UPLOADS, async ({ file, row }) => {
      try {
        const [shape, uploaded] = await Promise.all([
          probeImage(file),
          uploadFileToS3(file, galleryKeyPrefix(userId), GALLERY_ACCEPT),
        ]);
        patch(row.id, { status: "ready", upload: { imageKey: uploaded.s3Key, ...shape } });
      } catch (err) {
        patch(row.id, {
          status: "failed",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    });
  }

  function remove(id: string) {
    setRows((rs) => {
      const gone = rs.find((r) => r.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return rs.filter((r) => r.id !== id);
    });
  }

  const ready = rows.filter((r) => r.status === "ready");
  const busy = rows.some((r) => r.status === "uploading");
  const posting = fetcher.state !== "idle";
  const canPost = ready.length > 0 && !busy && !posting;

  function post() {
    const posts: NewGalleryPost[] = ready.map((r) => ({ ...r.upload!, caption: r.caption.trim() || null }));
    fetcher.submit(
      { intent: "create", posts: JSON.stringify(posts) },
      { method: "post", action: "/community/gallery" },
    );
  }

  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept={GALLERY_ACCEPT}
      multiple
      hidden
      onChange={(e) => {
        if (e.target.files) void addFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  return (
    <Modal open onClose={onClose} labelledBy={titleId} containerClassName={modalCardClass("max-w-[760px]")}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        <ModalHeader
          titleId={titleId}
          title="New posts"
          subtitle={
            rows.length === 0
              ? "Each photo becomes its own post."
              : `${rows.length} ${rows.length === 1 ? "photo" : "photos"}`
          }
          onClose={onClose}
        />
        {picker}

        {rows.length === 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-2 rounded-os-card border-2 border-dashed px-6 py-14 text-sm text-os-grey transition-colors hover:border-os-container-hi hover:text-foreground",
              dragging ? "border-os-accent bg-os-accent/5" : "border-os-container",
            )}
          >
            <ImagePlus className="h-7 w-7" aria-hidden />
            <span className="font-semibold text-foreground">Choose photos or drop them here</span>
            <span>Up to {GALLERY_MAX_PHOTOS} at a time</span>
          </button>
        ) : (
          <ul className={cn("os-form flex flex-col gap-3", dragging && "opacity-60")}>
            {rows.map((r) => (
              <li key={r.id} className="flex items-start gap-4 rounded-os-item bg-os-well p-3">
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-os-item bg-os-container">
                  <img src={r.previewUrl} alt="" className="h-full w-full object-cover" />
                  {r.status === "uploading" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                      <Loader2 className="h-5 w-5 animate-spin" aria-label="Uploading" />
                    </div>
                  )}
                </div>
                <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm text-os-grey">
                  Caption
                  <textarea
                    rows={2}
                    value={r.caption}
                    maxLength={GALLERY_CAPTION_MAX}
                    placeholder="Optional"
                    onChange={(e) => patch(r.id, { caption: e.target.value })}
                    className="resize-none"
                  />
                  {r.status === "failed" && (
                    <span className="text-xs text-destructive">
                      {r.name}: {r.error}
                    </span>
                  )}
                </label>
                <IconButton
                  label="Remove photo"
                  icon={Trash2}
                  tone="destructive"
                  onClick={() => remove(r.id)}
                />
              </li>
            ))}
          </ul>
        )}

        {notice && <p className="mt-3 text-sm text-destructive">{notice}</p>}

        <div className="mt-6 flex items-center gap-2">
          {rows.length > 0 && rows.length < GALLERY_MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-os-grey hover:text-foreground"
            >
              <ImagePlus className="h-4 w-4" aria-hidden />
              Add photos
            </button>
          )}
          <button type="button" onClick={onClose} className="os-btn-ghost ml-auto">
            Cancel
          </button>
          <button
            type="button"
            onClick={post}
            disabled={!canPost}
            className="os-btn-primary disabled:opacity-50"
          >
            {posting ? "Posting…" : ready.length > 1 ? `Post ${ready.length}` : "Post"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
