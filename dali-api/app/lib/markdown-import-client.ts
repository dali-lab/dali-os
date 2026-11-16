export const MARKDOWN_IMPORT_ACCEPT = ".md,.markdown,.txt,.zip,text/plain,text/markdown,application/zip";

export function skippedMessage(skipped: number): string {
  return skipped === 1
    ? "Imported. 1 image couldn't be added and was kept as a link."
    : `Imported. ${skipped} images couldn't be added and were kept as links.`;
}

export interface MarkdownImportDeps<Block> {
  fetch: typeof fetch;
  insert: (blocks: Block[]) => void;
  toast: { success: (message: string) => void; error: (message: string) => void };
}

export async function importMarkdownFile<Block>(
  pageId: string,
  file: File,
  { fetch, insert, toast }: MarkdownImportDeps<Block>,
): Promise<void> {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch(`/documents/${pageId}/import`, { method: "POST", body, credentials: "include" });
  const result = ((await res.json().catch(() => null)) ?? {}) as { blocks?: Block[]; skipped?: number; error?: string };
  if (!res.ok || !result.blocks) {
    toast.error(result.error ?? "Couldn't import that file.");
    return;
  }
  insert(result.blocks);
  if (result.skipped) toast.success(skippedMessage(result.skipped));
}
