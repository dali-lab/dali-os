import { useEffect, useState } from "react";
import { Download, FileText, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { categorize, type FileCategory } from "~/lib/file-type";
import { cn } from "~/lib/cn";
import { IconButton } from "~/components/ui/IconButton";

// Shared in-app file rendering. Two shapes:
//   - <FilePreview>    a large single-file preview (images/video/audio/pdf/text
//                      inline, download fallback otherwise) — used by the
//                      project file viewer.
//   - <FileAttachment> a compact row (thumbnail for images, "open" link
//                      otherwise) for lists like assignment submissions.
// Both classify through ~/lib/file-type so the "what is this / can we preview
// it" taxonomy stays identical across every surface. When content type is
// absent (e.g. education submission files store only { key, name }) it's
// inferred from the file extension there.

type ViewerProps = {
  previewUrl: string;
  fileName: string;
  reloadKey?: string;
  fullscreen: boolean;
};

// Category → inline renderer. Adding a new inline viewer (e.g. 3D, office) is a
// one-line entry here plus the category in file-type's PREVIEWABLE_INLINE — no
// call-site edits. Categories absent from this map fall back to download.
const VIEWERS: Partial<Record<FileCategory, (p: ViewerProps) => React.ReactElement>> = {
  image: ({ previewUrl, fileName, fullscreen }) => (
    <img
      src={previewUrl}
      alt={fileName}
      className={cn(
        "max-w-full rounded-lg border border-border object-contain bg-muted/20",
        fullscreen ? "max-h-full mx-auto" : "max-h-[70vh]",
      )}
    />
  ),
  video: ({ previewUrl, reloadKey, fullscreen }) => (
    <video
      key={reloadKey}
      src={previewUrl}
      controls
      className={cn(
        "max-w-full rounded-lg border border-border bg-black",
        fullscreen ? "max-h-full mx-auto" : "max-h-[70vh]",
      )}
    />
  ),
  audio: ({ previewUrl, reloadKey }) => (
    <audio key={reloadKey} src={previewUrl} controls className="w-full" />
  ),
  pdf: ({ previewUrl, fileName, reloadKey, fullscreen }) => (
    <iframe
      key={reloadKey}
      src={previewUrl}
      title={fileName}
      className={cn(
        "w-full rounded-lg border border-border bg-white",
        fullscreen ? "h-full" : "h-[70vh]",
      )}
    />
  ),
  text: ({ previewUrl, fileName, reloadKey, fullscreen }) => (
    <iframe
      key={reloadKey}
      src={previewUrl}
      title={fileName}
      className={cn(
        "w-full rounded-lg border border-border bg-white",
        fullscreen ? "h-full" : "h-[70vh]",
      )}
    />
  ),
};

/**
 * Large inline preview of a single file. `previewUrl` should serve the file
 * inline; `downloadUrl` forces a download. `reloadKey` forces media elements to
 * re-fetch when the previewed file changes.
 */
export function FilePreview({
  previewUrl,
  downloadUrl,
  contentType,
  fileName,
  reloadKey,
}: {
  previewUrl: string;
  downloadUrl: string;
  contentType?: string | null;
  fileName: string;
  reloadKey?: string;
}) {
  const category = categorize({ fileName, contentType });
  const Viewer = VIEWERS[category];
  // Audio is just a control bar, nothing to gain from the whole viewport.
  const canFullscreen = Viewer != null && category !== "audio";
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  if (Viewer) {
    return (
      <div
        className={cn(
          fullscreen && "fixed inset-0 z-40 flex flex-col gap-3 bg-background p-4 sm:p-6",
        )}
      >
        {canFullscreen && (
          <div className={cn("flex items-center justify-end gap-2", !fullscreen && "mb-2")}>
            {fullscreen && (
              <span className="flex-1 truncate text-sm font-medium text-foreground">
                {fileName}
              </span>
            )}
            <IconButton
              label={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
              icon={fullscreen ? Minimize2 : Maximize2}
              onClick={() => setFullscreen((f) => !f)}
            />
          </div>
        )}
        <div className={cn(fullscreen && "flex-1 min-h-0 flex items-center justify-center")}>
          <Viewer
            previewUrl={previewUrl}
            fileName={fileName}
            reloadKey={reloadKey}
            fullscreen={fullscreen}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
      <p>
        No inline preview for this file type
        {contentType ? ` (${contentType})` : ""}.
      </p>
      <a
        href={downloadUrl}
        className="mt-3 inline-flex items-center gap-1 text-accent-coral hover:underline"
      >
        <Download className="w-3.5 h-3.5" />
        Download to view
      </a>
    </div>
  );
}

/**
 * Compact attachment row: image thumbnail (opens full on click) or an "open"
 * link for everything else. `url` should serve the file inline (e.g.
 * /api/upload/raw?key=...). Optional trailing slot (e.g. a Remove button).
 */
export function FileAttachment({
  url,
  fileName,
  contentType,
  trailing,
}: {
  url: string;
  fileName: string;
  contentType?: string | null;
  trailing?: React.ReactNode;
}) {
  const isImage = categorize({ fileName, contentType }) === "image";
  return (
    <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
      {isImage ? (
        <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
          <img
            src={url}
            alt={fileName}
            className="h-12 w-12 rounded object-cover border border-border bg-muted/20"
          />
        </a>
      ) : (
        <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
      )}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex-1 truncate text-sm text-foreground hover:text-accent-coral hover:underline"
      >
        {fileName}
      </a>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        title="Open"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
      {trailing}
    </div>
  );
}
