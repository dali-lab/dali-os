import { getExtension } from "./file-type";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const MAX_UPLOAD_LABEL = "10 MB";

/** Project files and Lab Documents (Drive) — decks, recordings, datasets. */
export const MAX_FILE_STORE_BYTES = 100 * 1024 * 1024;

export const MAX_FILE_STORE_LABEL = "100 MB";

// Key prefixes (under uploads/) that land in the ProjectFile store: the project
// Files tab and task attachments, a non-project file's new version, and the
// Drive hub (Lab and My Drive share one prefix). Keyed by prefix rather than by
// caller permission on purpose — any signed-in member can already create a My
// Drive file, so a permission check at presign time would narrow nothing;
// access is decided where the file is registered.
const FILE_STORE_PREFIXES = ["project-files/", "lab-files/", "drive-files/"];

export type UploadCap = { maxBytes: number; label: string; expiresIn: number };

export const DEFAULT_UPLOAD_CAP: UploadCap = {
  maxBytes: MAX_UPLOAD_BYTES,
  label: MAX_UPLOAD_LABEL,
  expiresIn: 300,
};

/** The size cap and presigned-POST lifetime for an upload key. Accepts the key
 *  with or without its `uploads/` scope, since the browser builds the prefix
 *  and the presign route adds the scope. Shared by the client pre-check and
 *  the signed policy so the two can't disagree. */
export function uploadCapForKey(key: string): UploadCap {
  const unscoped = key.replace(/^\/+/, "").replace(/^uploads\//, "");
  if (FILE_STORE_PREFIXES.some((p) => unscoped.startsWith(p))) {
    // 15 minutes: a 100 MB body on a slow link, or an MCP agent that has to
    // turn the response into a curl call first.
    return { maxBytes: MAX_FILE_STORE_BYTES, label: MAX_FILE_STORE_LABEL, expiresIn: 900 };
  }
  return DEFAULT_UPLOAD_CAP;
}

// Defense-in-depth: known-dangerous types/extensions rejected regardless of
// what a caller's `accept` config says. Shared by the presign route and the
// MCP upload tool so the two upload paths can't drift.
export const BLOCKED_UPLOAD_TYPES = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-sh",
  "application/x-bat",
  "application/x-csh",
  "application/x-executable",
  "application/x-mach-binary",
]);

export const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".sh",
  ".ps1",
  ".msi",
  ".dll",
  ".app",
  ".dmg",
  ".scr",
]);

export function isBlockedUpload(fileName: string, contentType: string): boolean {
  const ext = getExtension(fileName);
  return (
    BLOCKED_UPLOAD_TYPES.has(contentType.toLowerCase()) ||
    (ext !== "" && BLOCKED_UPLOAD_EXTENSIONS.has(ext))
  );
}

export function fileMatchesAccept(
  fileName: string,
  fileType: string,
  accept: string | undefined,
): boolean {
  if (!accept || !accept.trim()) return true;

  const entries = accept
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) return true;

  const ext = getExtension(fileName);
  const type = (fileType ?? "").toLowerCase();

  for (const entry of entries) {
    if (entry.startsWith(".")) {
      if (ext === entry) return true;
      continue;
    }
    if (entry.endsWith("/*")) {
      const prefix = entry.slice(0, -1);
      if (type.startsWith(prefix)) return true;
      continue;
    }
    if (type && type === entry) return true;
  }
  return false;
}
