export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const MAX_UPLOAD_LABEL = "10 MB";

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
