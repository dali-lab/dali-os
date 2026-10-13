import type { ReceiverFolderType, ReceiverProcessType } from "~/lib/drive-receivers";
import type { ReceiverRequest } from "~/components/drive/receiver-options";

export const FOLDER_RECEIVERS_URL = "/api/folder-receivers";

export type ReceiverSlotRow = {
  folderType: ReceiverFolderType;
  label: string;
  folder: { id: string; title: string; path: Array<{ id: string; title: string }> } | null;
};

export async function fetchReceiverSlots(
  processType: ReceiverProcessType,
  processId: string | null,
): Promise<ReceiverSlotRow[] | null> {
  const params = new URLSearchParams({ processType, processId: processId ?? "" });
  try {
    const res = await fetch(`${FOLDER_RECEIVERS_URL}?${params.toString()}`, { credentials: "include" });
    if (!res.ok) return null;
    const json = (await res.json()) as { slots?: ReceiverSlotRow[] };
    return json.slots ?? null;
  } catch {
    return null;
  }
}

/** Sends one receiver write; resolves to the API's error text on failure so callers can toast it. */
export async function sendReceiverRequest(body: ReceiverRequest): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(FOLDER_RECEIVERS_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: json?.error ?? "That didn't save. Try again." };
  } catch {
    return { ok: false, error: "That didn't save. Try again." };
  }
}

/** Breadcrumb text for a receiver folder, e.g. "Core / Templates / Agreements". */
export function pathText(path: Array<{ title: string }>): string {
  return path.map((p) => p.title || "Untitled folder").join(" / ");
}
