import { Download, FileText, ExternalLink } from "lucide-react";

// Shared in-app file rendering. Two shapes:
//   - <FilePreview>    a large single-file preview (images/video/audio/pdf/text
//                      inline, download fallback otherwise) — used by the
//                      project file viewer.
//   - <FileAttachment> a compact row (thumbnail for images, "open" link
//                      otherwise) for lists like assignment submissions.
// Both key off content type; when it's absent (e.g. education submission files
// store only { key, name }) it's inferred from the file extension.

const EXT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

export function inferContentType(fileName: string, provided?: string | null): string {
  if (provided) return provided;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPE[ext] ?? "";
}

type Kind = "image" | "video" | "audio" | "pdf" | "text" | "other";

function kindOf(contentType: string): Kind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("text/") || contentType === "application/json") return "text";
  return "other";
}

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
  const kind = kindOf(inferContentType(fileName, contentType));

  if (kind === "video") {
    return (
      <video
        key={reloadKey}
        src={previewUrl}
        controls
        className="max-w-full max-h-[70vh] rounded-lg border border-border bg-black"
      />
    );
  }
  if (kind === "audio") {
    return <audio key={reloadKey} src={previewUrl} controls className="w-full" />;
  }
  if (kind === "image") {
    return (
      <img
        src={previewUrl}
        alt={fileName}
        className="max-w-full max-h-[70vh] rounded-lg border border-border object-contain bg-muted/20"
      />
    );
  }
  if (kind === "pdf" || kind === "text") {
    return (
      <iframe
        key={reloadKey}
        src={previewUrl}
        title={fileName}
        className="w-full h-[70vh] rounded-lg border border-border bg-white"
      />
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
  const isImage = kindOf(inferContentType(fileName, contentType)) === "image";
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
