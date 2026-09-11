// Single source of truth for "what kind of file is this, and can we preview it?"
// Client-safe (no Prisma) — the read-side sibling of file-validation.ts, which
// owns the write/ingest side ("can it come in?"). Every preview surface (the
// full file page, Drive Quick Look, the partner shared-file modal, compact
// attachment rows) classifies through categorize()/canPreviewInline() so the
// taxonomy can't drift between them.

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "office"
  | "archive"
  | "model3d"
  | "other";

// Extension → MIME, used to recover a content type when the stored one is
// missing or the useless "application/octet-stream" (browsers report that when
// File.type is empty). Only needs entries for the types we classify; unknown
// extensions fall through to `other`.
const EXT_TYPE: Record<string, string> = {
  // image
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  // pdf
  pdf: "application/pdf",
  // video
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  // text
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  // office (classified for icons + fallback; no viewer today)
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // archive
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  // 3d / cad
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  stl: "model/stl",
  obj: "model/obj",
};

const OFFICE_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const ARCHIVE_TYPES = new Set([
  "application/zip",
  "application/gzip",
  "application/x-tar",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
]);

// Only categories with a real inline renderer today. Surfaces that decide
// whether to *offer* a preview affordance (e.g. Drive Quick Look) gate on this.
const PREVIEWABLE_INLINE = new Set<FileCategory>([
  "image",
  "video",
  "audio",
  "pdf",
  "text",
]);

/** Lowercased extension including the leading dot (".pdf"), or "" if none. */
export function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx).toLowerCase();
}

/**
 * Best-effort content type: prefer a real stored type, but fall back to the
 * extension map when it's missing or the generic "application/octet-stream"
 * (which uploads default to when the browser reports no File.type — so a
 * perfectly-viewable PDF can arrive as octet-stream).
 */
export function resolveContentType(fileName: string, provided?: string | null): string {
  const p = (provided ?? "").trim();
  if (p && p.toLowerCase() !== "application/octet-stream") return p;
  const ext = getExtension(fileName).slice(1);
  return EXT_TYPE[ext] ?? p;
}

export function categorize(input: {
  fileName: string;
  contentType?: string | null;
}): FileCategory {
  const ct = resolveContentType(input.fileName, input.contentType).toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  if (ct === "application/pdf") return "pdf";
  if (ct.startsWith("text/") || ct === "application/json") return "text";
  if (ct.startsWith("model/")) return "model3d";
  if (OFFICE_TYPES.has(ct)) return "office";
  if (ARCHIVE_TYPES.has(ct)) return "archive";
  return "other";
}

export function canPreviewInline(category: FileCategory): boolean {
  return PREVIEWABLE_INLINE.has(category);
}
