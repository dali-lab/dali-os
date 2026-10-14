export type DroppedFiles = { files: File[]; skippedFolders: number };

/**
 * Files from an OS drop, minus directories. A dropped folder shows up in
 * `dataTransfer.files` as a bogus empty file, so directories are told apart
 * through `webkitGetAsEntry`, which is only readable during the drop event.
 */
export function droppedFiles(dt: DataTransfer): DroppedFiles {
  const items = Array.from(dt.items ?? []).filter((item) => item.kind === "file");
  if (items.length === 0) return { files: Array.from(dt.files ?? []), skippedFolders: 0 };
  const files: File[] = [];
  let skippedFolders = 0;
  for (const item of items) {
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      skippedFolders += 1;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, skippedFolders };
}
