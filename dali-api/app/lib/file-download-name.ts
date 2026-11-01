const MAX_NAME_CHARS = 200;
const EXTENSION = /\.[A-Za-z0-9]{1,10}$/;

function cleanName(name: string): string {
  return name
    .replace(/[\p{Cc}\p{Cs}]/gu, "")
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/^[.\s]+/, "")
    .trim();
}

function splitExtension(name: string): { stem: string; ext: string } {
  const ext = name.match(EXTENSION)?.[0] ?? "";
  return { stem: ext ? name.slice(0, -ext.length) : name, ext };
}

/** The name a file saves under: its current title, keeping the upload's extension. */
export function downloadFileName(title: string, uploadedName: string): string {
  const uploaded = cleanName(uploadedName);
  const wanted = cleanName(title) || uploaded || "file";
  const { ext } = splitExtension(uploaded);
  const named = ext && !wanted.toLowerCase().endsWith(ext.toLowerCase()) ? `${wanted}${ext}` : wanted;
  const parts = splitExtension(named);
  return [...parts.stem].slice(0, MAX_NAME_CHARS - parts.ext.length).join("") + parts.ext;
}

/** Numbers repeats ("Report (1).pdf"), ignoring case because Windows and macOS do. */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const { stem, ext } = splitExtension(name);
    let candidate = name;
    for (let n = 1; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
