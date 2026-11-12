import { Folder } from "lucide-react";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import type { DriveItem } from "~/drive/lib/drive.server";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import { FolderPicker } from "~/components/drive/FolderPicker";
import { moveDriveItem, driveErrorFrom, isPageItem } from "~/components/drive/move-item";
import { type PendingHidden } from "~/components/drive/pending-hidden";
import { runTrash } from "~/components/drive/trash-batch";
import { type DriveHistory } from "~/components/drive/use-drive-history";
import { useDriveFileUpload } from "~/components/drive/useDriveFileUpload";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Select } from "~/components/ui/floating";
import { isProcessRootSpace } from "~/drive/lib/drive-spaces";
import type { DriveScope } from "~/routes/drive.hub";

export type ScopeKind = "mine" | "lab" | "project" | "projects-group" | "education-group";

// The Core drive is Lab-workspace pages nested under the Core root folder, so it
// uses the same endpoints as Lab — its rootFolderId (below) handles the nesting.
// "projects" and "education" are the new synthetic parent scopes (flag ON).
export function scopeKindOf(id: string): ScopeKind {
  if (id === "mine") return "mine";
  if (id === "lab" || isProcessRootSpace(id)) return "lab";
  if (id === "projects") return "projects-group";
  if (id === "education") return "education-group";
  return "project";
}

// Who can see items in a scope — shown in the cross-drive move confirmation so
// the mover knows a move re-scopes visibility.
export function scopeAudience(scopeId: string): string {
  if (scopeId === "core" || scopeId === "hiring") return "Core only";
  if (scopeId === "mentorship") return "mentors";
  if (scopeId === "lab") return "everyone in the lab";
  // Synthetic group scopes shouldn't appear in move dialogs, but guard anyway.
  if (scopeId === "projects") return "the project team";
  if (scopeId === "education") return "enrolled members";
  return "the project team";
}

// A scope's workspace + drive-root parent for a cross-drive move.
// Lab and Core are both Lab-workspace pages; a project scope is its own
// Project workspace; My Drive is
// the viewer's own Member workspace. My Drive only ever appears here as a
// SOURCE — moveDestinationsFor filters it out of the picker, and the move
// endpoint refuses it as a destination — but naming it correctly is what makes a
// move OUT of it register as cross-workspace.
// The synthetic "projects"/"education" group scopes are not valid move destinations
// (dropping onto them is disabled in DriveBrowser), so they return a safe Lab
// default rather than throwing — the hub guards against them via moveDestinationsFor.
export function scopeDest(
  scope: DriveTreeScope,
  viewerId: string,
): {
  workspaceType: "Lab" | "Project" | "Member";
  workspaceId: string | null;
  root: string | null;
} {
  const kind = scopeKindOf(scope.id);
  if (kind === "mine") return { workspaceType: "Member", workspaceId: viewerId, root: null };
  if (kind === "project") return { workspaceType: "Project", workspaceId: scope.id, root: scope.rootFolderId ?? null };
  // projects-group / education-group: safe no-op fallback (never a move target).
  if (kind === "projects-group" || kind === "education-group") return { workspaceType: "Lab", workspaceId: null, root: null };
  return { workspaceType: "Lab", workspaceId: null, root: scope.rootFolderId ?? null };
}

// A folder's own id plus every descendant folder id — so "Move to…" never
// offers a folder as a destination for itself or its own subtree.
export function folderAndDescendants(items: DriveItem[], folderId: string): Set<string> {
  const childMap = new Map<string, string[]>();
  for (const it of items) {
    if (it.type !== "folder") continue;
    const p = it.parentFolderId ?? "_root_";
    const list = childMap.get(p);
    if (list) list.push(it.id);
    else childMap.set(p, [it.id]);
  }
  const out = new Set([folderId]);
  const queue = [folderId];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const c of childMap.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        queue.push(c);
      }
    }
  }
  return out;
}

export type ScopeActions = {
  createDoc: () => Promise<void>;
  createFolder: () => Promise<void>;
  createWhiteboard: () => Promise<void>;
  createSlides: (presetName?: string) => Promise<string | null>;
  rename: (item: DriveItem) => Promise<void>;
  remove: (item: DriveItem) => Promise<void>;
  /** Delete request without the confirm/toast — used by bulk delete. */
  deleteItem: (item: DriveItem) => Promise<Response>;
  /** Move within this scope. Reports nothing: the caller speaks for the whole batch. `onError` gets the reason a move was refused. */
  performMove: (
    item: DriveItem,
    destFolderId: string | null,
    opts?: { onError?: (message: string) => void },
  ) => Promise<boolean>;
};

// Given the "projects" or "education" synthetic group scope, walk up the item
// tree from folderId to find the synthetic top-level folder (parentFolderId ===
// null), whose id IS the project/offering id. Returns null if we're at the
// scope root (no folder selected) — create should be a no-op there.
export function resolveWorkspaceId(items: DriveItem[], folderId: string | null): string | null {
  if (!folderId) return null;
  const byId = new Map(items.map((it) => [it.id, it]));
  let cursor: string | null = folderId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    if (node.parentFolderId === null) return node.id; // synthetic top-level = workspace id
    cursor = node.parentFolderId;
  }
  return null;
}

// Education materials are a two-level tree (createMaterialPage): folders sit
// only at an offering's top level and hold documents, never other folders.
// Returns why the Education drive would refuse this create, or null if allowed.
export function educationCreateBlock(
  items: DriveItem[],
  folderId: string | null,
  pageKind: "FreeForm" | "Folder",
): string | null {
  if (!resolveWorkspaceId(items, folderId)) return "Open an offering first";
  if (pageKind === "Folder" && items.find((it) => it.id === folderId)?.parentFolderId !== null) {
    return "Folders can't go inside folders";
  }
  return null;
}

export type CreatedPage = { id: string } | { error: string | undefined };

export async function createdPage(res: Response): Promise<CreatedPage> {
  if (res.ok) return { id: ((await res.json()) as { id: string }).id };
  return { error: await driveErrorFrom(res) };
}

export function makeScopeActions({
  scope,
  currentFolderId,
  dialog,
  toast,
  revalidate,
  onCreated,
  hiding,
  history,
}: {
  scope: DriveScope;
  /** Folder the browser is currently in within this scope — new items land
   *  here. null = the scope's top level. */
  currentFolderId: string | null;
  dialog: ReturnType<typeof useDialog>;
  toast: ReturnType<typeof useToast>;
  revalidate: () => void;
  /** Called with the id of an item just created in place, so the browser can reveal it. */
  onCreated: (id: string) => void;
  hiding: Pick<PendingHidden, "hide">;
  history: DriveHistory;
}): ScopeActions {
  const kind = scopeKindOf(scope.id);
  // The DB parent that this scope's "top level" maps to — null for most drives,
  // the Core root folder for the Core drive (so items land inside the scope).
  const rootParent = scope.rootFolderId ?? null;
  // New items are created in the current folder, falling back to the scope's
  // top level (rootParent) when browsing at the scope root.
  const createParent = currentFolderId ?? rootParent;

  async function createPage(
    pageKind: "FreeForm" | "Folder" | "Whiteboard" | "Slides",
    title: string,
    parentPageId: string | null,
  ): Promise<CreatedPage> {
    if (kind === "mine") {
      const fd = new FormData();
      fd.set("intent", "create");
      fd.set("title", title);
      fd.set("isFolder", pageKind === "Folder" ? "true" : "false");
      fd.set("kind", pageKind);
      if (parentPageId) fd.set("parentPageId", parentPageId);
      const res = await fetch("/api/notes", { method: "POST", body: fd, credentials: "include" });
      return createdPage(res);
    }
    if (kind === "projects-group") {
      // Resolve the project from the current folder. When parentPageId is a
      // synthetic project folder id (top-level, parentFolderId=null in scope.items),
      // that id IS the projectId and we pass parentPageId=null to the project API.
      // When deeper inside a real sub-folder, walk up to find the synthetic root.
      const projectId = resolveWorkspaceId(scope.items, parentPageId);
      if (!projectId) return { error: undefined }; // no-op: at the group root, no project selected
      // If parentPageId IS the synthetic project folder, the real parentPageId is null.
      const parentNode = parentPageId ? scope.items.find((it) => it.id === parentPageId) : null;
      const realParent = parentNode?.parentFolderId === null ? null : parentPageId;
      const res = await fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind: pageKind, ...(realParent ? { parentPageId: realParent } : {}) }),
      });
      return createdPage(res);
    }
    if (kind === "education-group") {
      // Mirror the projects-group branch: resolve the offering, strip the
      // synthetic top-level node from parentPageId, then POST to the offering
      // documents endpoint. Instructors and Core only (server-enforced).
      const offeringId = resolveWorkspaceId(scope.items, parentPageId);
      if (!offeringId) return { error: undefined }; // no-op: at the group root, no offering selected
      const parentNode = parentPageId ? scope.items.find((it) => it.id === parentPageId) : null;
      const realParent = parentNode?.parentFolderId === null ? null : parentPageId;
      const res = await fetch(`/api/education/${offeringId}/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind: pageKind, ...(realParent ? { parentPageId: realParent } : {}) }),
      });
      return createdPage(res);
    }
    const url = kind === "lab" ? "/api/lab-documents" : `/api/projects/${scope.id}/documents`;
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, kind: pageKind, ...(parentPageId ? { parentPageId } : {}) }),
    });
    return createdPage(res);
  }

  async function createDoc() {
    const name = await dialog.prompt({
      title: "New document",
      label: "Name",
      defaultValue: "Untitled",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const created = await createPage("FreeForm", name.trim(), createParent);
    if ("id" in created) onCreated(created.id);
    else toast.error(created.error ?? "Couldn't create the document");
  }

  async function createFolder() {
    const name = await dialog.prompt({
      title: "New folder",
      label: "Folder name",
      defaultValue: "New folder",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const created = await createPage("Folder", name.trim(), createParent);
    if ("id" in created) {
      toast.success("Folder created");
      onCreated(created.id);
    } else {
      toast.error(created.error ?? "Couldn't create the folder");
    }
  }

  async function createWhiteboard() {
    const name = await dialog.prompt({
      title: "New whiteboard",
      label: "Name",
      defaultValue: "Untitled whiteboard",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const created = await createPage("Whiteboard", name.trim(), createParent);
    if ("id" in created) onCreated(created.id);
    else toast.error(created.error ?? "Couldn't create the whiteboard");
  }

  async function createSlides(presetName?: string): Promise<string | null> {
    const name =
      presetName ??
      (await dialog.prompt({
        title: "New slide deck",
        label: "Name",
        defaultValue: "Untitled deck",
        confirmLabel: "Create",
        validate: (v) => (v.trim() ? null : "Enter a name"),
      }));
    if (name === null) return null;
    const created = await createPage("Slides", name.trim(), createParent);
    if ("id" in created) {
      if (presetName === undefined) onCreated(created.id);
      return created.id;
    }
    toast.error(created.error ?? "Couldn't create the slide deck");
    return null;
  }

  async function rename(item: DriveItem) {
    const name = await dialog.prompt({
      title: "Rename",
      label: "Name",
      defaultValue: item.title,
      confirmLabel: "Save",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const next = name.trim();
    if (next === item.title) return;

    let res: Response;
    if (item.type === "form") {
      const fd = new FormData();
      fd.set("intent", "rename-form");
      fd.set("id", item.id);
      fd.set("name", next);
      res = await fetch("/api/forms", { method: "POST", body: fd, credentials: "include" });
    } else if (item.type === "file") {
      res = await fetch(`/api/files/${item.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "rename", title: next }),
      });
    } else if (item.type === "agreement") {
      // Agreements have no Page row — rename via the agreement route's own
      // action (the same intent the in-doc rename posts), not /api/documents.
      const fd = new FormData();
      fd.set("intent", "rename");
      fd.set("name", next);
      res = await fetch(`/documents/agreement/${item.id}`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
    } else if (kind === "mine") {
      const fd = new FormData();
      fd.set("intent", "update");
      fd.set("pageId", item.id);
      fd.set("title", next);
      res = await fetch("/api/notes", { method: "POST", body: fd, credentials: "include" });
    } else {
      res = await fetch(`/api/documents/${item.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
    }
    if (res.ok) {
      toast.success("Renamed");
      revalidate();
    } else {
      toast.error((await driveErrorFrom(res)) ?? "Couldn't rename");
    }
  }

  // The raw delete request for an item, routed to the right endpoint. No
  // confirm/toast — the single-item `remove` and the hub's bulk delete wrap it.
  // Forms are now SOFT-ARCHIVED (archivedAt = now) from Drive, matching how
  // docs and files are handled. Hard-delete is reserved for Trash ("purge").
  async function deleteItem(item: DriveItem): Promise<Response> {
    if (item.type === "form") {
      const fd = new FormData();
      fd.set("intent", "archive-form");
      fd.set("id", item.id);
      return fetch("/api/drive/trash", { method: "POST", body: fd, credentials: "include" });
    }
    if (item.type === "file") {
      return fetch(`/api/files/${item.id}`, { method: "DELETE", credentials: "include" });
    }
    if (kind === "mine") {
      const fd = new FormData();
      fd.set("intent", "archive");
      fd.set("pageId", item.id);
      return fetch("/api/notes", { method: "POST", body: fd, credentials: "include" });
    }
    return fetch(`/api/documents/${item.id}`, { method: "DELETE", credentials: "include" });
  }

  async function remove(item: DriveItem) {
    const confirmed = await dialog.confirm({
      title: `Delete "${item.title || "Untitled"}"?`,
      description:
        item.type === "folder"
          ? "The folder must be empty first."
          : item.type === "form"
            ? "The form will be moved to Trash. Restore it any time from Trash, or purge it there permanently."
            : "It will be archived and removed from your Drive.",
      tone: "destructive",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    await runTrash({ items: [item], deleteOne: deleteItem, hiding, history, toast, revalidate });
  }

  async function performMove(
    item: DriveItem,
    destFolderId: string | null,
    opts?: { onError?: (message: string) => void },
  ): Promise<boolean> {
    // The scope's top level maps to rootParent (the Core folder for the Core
    // drive; null elsewhere), so "move to top" keeps items inside the scope.
    const target = destFolderId ?? rootParent;
    let res: Response;
    if (isPageItem(item)) {
      if (kind === "mine") {
        const fd = new FormData();
        fd.set("intent", "update");
        fd.set("pageId", item.id);
        fd.set("parentPageId", target ?? "");
        res = await fetch("/api/notes", { method: "POST", body: fd, credentials: "include" });
      } else if (kind === "projects-group" || kind === "education-group") {
        // Dragging within the synthetic group scope (projects/education). If the
        // destination is a synthetic top-level folder (the project/offering node
        // itself, parentFolderId===null), it's a cross-workspace move to that
        // workspace's root. If it's a real sub-folder inside a project/offering,
        // it's still a cross-workspace move but with a real parentPageId.
        const wsId = resolveWorkspaceId(scope.items, target);
        if (!wsId) {
          // No workspace resolved (e.g. dropped at the group root) — no-op.
          opts?.onError?.("Select a project or offering to move into");
          return false;
        }
        const wsType = kind === "projects-group" ? "Project" : "EducationOffering";
        // If target IS the synthetic top-level node, the real parentPageId is null
        // (move to the workspace root). Otherwise target is a real sub-folder.
        const destNode = target ? scope.items.find((it) => it.id === target) : null;
        const realParent = destNode?.parentFolderId === null ? null : (target ?? null);
        res = await fetch(`/api/pages/${item.id}/move`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentPageId: realParent,
            workspaceType: wsType,
            workspaceId: wsId,
          }),
        });
      } else {
        res = await moveDriveItem(item, target);
      }
    } else {
      res = await moveDriveItem(item, target);
    }
    if (!res.ok) {
      const reason = await driveErrorFrom(res);
      if (reason) opts?.onError?.(reason);
    }
    return res.ok;
  }

  return { createDoc, createFolder, createWhiteboard, createSlides, rename, remove, deleteItem, performMove };
}

// ── New menu (contextual to the current location) ────────────────────────────
