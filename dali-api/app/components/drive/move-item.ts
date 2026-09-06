import type { DriveItem } from "~/lib/drive.server";

// The one place that knows how to ask the server to re-file a drive item.
//
// Two endpoints back a move: pages (docs and folders) carry their placement in
// `Page.parentPageId` and move via POST /api/pages/:id/move, while everything
// else (files, forms, email templates) carries a `folderPageId` and moves via
// POST /api/drive/move. Which endpoint, and what each one calls its
// destination field, lived in both the Drive hub and the project embed — and
// the two drifted: the embed was posting `{ folderId }` to the pages endpoint,
// which requires `parentPageId`, so every doc/folder move from a project (drag
// and drop and "Move to" alike) failed schema validation with a 400 and was
// swallowed by a silent error branch.
//
// Cross-workspace moves (the hub's project/education group scopes, and My
// Drive's notes endpoint) carry extra destination fields and stay in the hub.

/** True when this item's placement lives on `Page`, not on a `folderPageId`. */
export function isPageItem(item: DriveItem): boolean {
  return item.type === "doc" || item.type === "folder";
}

/**
 * Re-file `item` into `destFolderPageId` (null = the scope's top level) within
 * the workspace it already belongs to. Returns the raw response so the caller
 * can decide what to say about a failure.
 */
export function moveDriveItem(item: DriveItem, destFolderPageId: string | null): Promise<Response> {
  if (isPageItem(item)) {
    return fetch(`/api/pages/${item.id}/move`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPageId: destFolderPageId }),
    });
  }
  return fetch("/api/drive/move", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemType: item.type, itemId: item.id, destFolderPageId }),
  });
}

/** The `error` message an API route returned, if it sent one. */
export async function driveErrorFrom(res: Response): Promise<string | undefined> {
  return ((await res.json().catch(() => ({}))) as { error?: string }).error;
}
