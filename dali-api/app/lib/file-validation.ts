export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const MAX_UPLOAD_LABEL = "10 MB";

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

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx).toLowerCase();
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
