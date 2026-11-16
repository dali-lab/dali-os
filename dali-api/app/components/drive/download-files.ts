import type { ReactNode } from "react";
import type { DriveItem } from "~/drive/lib/drive.server";

/** The slice of `useToast()` this needs, so the helper stays testable. */
export type DownloadToast = {
  info: (message: ReactNode, opts?: { duration?: number }) => void;
  error: (message: ReactNode, opts?: { duration?: number }) => void;
};

type ZipResponse = { url: string; included: number; skipped: number };

function filesIn(items: DriveItem[]) {
  return items.filter((item) => item.type === "file");
}

/** Only files download: docs, forms and agreements have their own exports. */
export function hasDownloadable(items: DriveItem[]): boolean {
  return filesIn(items).length > 0;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** One file saves directly; several become a ZIP the server builds first. */
export async function downloadItems(
  items: DriveItem[],
  { toast, open }: { toast: DownloadToast; open: (url: string) => void },
): Promise<void> {
  const files = filesIn(items);
  if (files.length === 0) return;
  const notFiles = items.length - files.length;
  if (files.length === 1 && notFiles === 0) {
    open(`/api/files/${files[0].id}/download`);
    return;
  }

  toast.info(`Preparing a ZIP of ${plural(files.length, "file")}…`);
  try {
    const res = await fetch("/api/drive/download", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds: files.map((f) => f.id) }),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<ZipResponse> & { error?: string };
    if (!res.ok || !body.url) {
      toast.error(body.error ?? "Couldn't prepare the download");
      return;
    }
    open(body.url);
    const skipped = (body.skipped ?? 0) + notFiles;
    if (skipped > 0) {
      toast.info(`${plural(skipped, "item")} left out. Only files you can view are included.`);
    }
  } catch {
    toast.error("Couldn't prepare the download");
  }
}
