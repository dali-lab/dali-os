import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { uploadEditorImage, IMAGE_UPLOAD_ACCEPT } from "./image";

// Notion-style page cover banner. Surfaces Page.coverImageUrl; uploads reuse
// the editor's S3 image pipeline (stable /api/upload/raw src). Persistence is
// the host's job via onChange.
export function PageCover({
  coverImageUrl,
  editing,
  onChange,
}: {
  coverImageUrl: string | null;
  editing: boolean;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onPicked(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const src = await uploadEditorImage(file);
      onChange(src);
    } catch (err) {
      console.error("[cover] upload failed", err);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  // Nothing to show and can't edit → render nothing (no empty band).
  if (!coverImageUrl && !editing) return null;

  if (!coverImageUrl) {
    // Editing, no cover yet: a slim "Add cover" affordance.
    return (
      <div className="mb-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <ImagePlus className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Add cover"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => void onPicked(e.target.files)}
        />
      </div>
    );
  }

  return (
    <div className="group relative mb-4 h-40 w-full overflow-hidden rounded-lg sm:h-48">
      <img src={coverImageUrl} alt="" className="h-full w-full object-cover" />
      {editing && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/75 disabled:opacity-50"
          >
            <ImagePlus className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Change"}
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/75"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_UPLOAD_ACCEPT}
            className="hidden"
            onChange={(e) => void onPicked(e.target.files)}
          />
        </div>
      )}
    </div>
  );
}
