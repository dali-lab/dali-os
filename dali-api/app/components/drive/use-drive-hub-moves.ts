import { useCallback, useRef, useState } from "react";
import type { DriveItem } from "~/drive/lib/drive.server";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import type { PickerDrive, PickerFolder, Destination } from "~/components/drive/FolderPicker";
import { buildPickerRows } from "~/components/drive/picker-rows";
import { driveErrorFrom, isPageItem } from "~/components/drive/move-item";
import { destinationLabel } from "~/components/drive/action-toast";
import { reportMoveBatch, runHiddenMoveBatch, itemCount, type Landed } from "~/components/drive/move-batch";
import type { PendingHidden } from "~/components/drive/pending-hidden";
import type { DriveHistory } from "~/components/drive/use-drive-history";
import { scopeKindOf, scopeAudience, scopeDest, folderAndDescendants, resolveWorkspaceId, type ScopeActions } from "~/components/drive/scope-actions";
import { isVirtualSpace } from "~/drive/lib/drive-spaces";
import type { useDialog } from "~/components/ui/dialog";
import type { useToast } from "~/components/ui/toast";

export type DriveHubMovesOptions = {
  driveScopes: DriveTreeScope[];
  viewerId: string;
  effectiveScopeId: string | null;
  scopeActionsMap: Map<string, ScopeActions>;
  scopeActionsRef: { current: Map<string, ScopeActions> };
  dialog: ReturnType<typeof useDialog>;
  toast: ReturnType<typeof useToast>;
  history: DriveHistory;
  revalidate: () => void;
  pendingHidden: PendingHidden;
};

export function useDriveHubMoves({
  driveScopes,
  viewerId,
  effectiveScopeId,
  scopeActionsMap,
  scopeActionsRef,
  dialog,
  toast,
  history,
  revalidate,
  pendingHidden,
}: DriveHubMovesOptions) {
  // "Move to…" destination picker. Opened imperatively by pickMoveDestination,
  // which returns a promise the bulk/single move flows await; the resolver is
  // called on confirm (with the chosen destination) or cancel (with null).
  const [movePicker, setMovePicker] = useState<null | {
    heading: string;
    drives: PickerDrive[];
    folders: PickerFolder[];
    disabledFolderIds?: Set<string>;
    disabledDest?: Destination | null;
    initial?: Destination;
  }>(null);
  const movePickerResolve = useRef<((d: Destination | null) => void) | null>(null);
  const resolveMovePicker = useCallback((dest: Destination | null) => {
    setMovePicker(null);
    const resolve = movePickerResolve.current;
    movePickerResolve.current = null;
    resolve?.(dest);
  }, []);

  // Dropping a selection onto a folder within the same drive.
  const onMove = useCallback(
    (scopeId: string, items: DriveItem[], destFolderId: string | null) => {
      const scope = driveScopes.find((s) => s.id === scopeId);
      const actions = scopeActionsMap.get(scopeId);
      if (!scope || !actions || items.length === 0) return;
      void (async () => {
        let failure: string | undefined;
        const landed = await runHiddenMoveBatch(
          items,
          (item) =>
            actions.performMove(item, destFolderId, {
              onError: (message) => {
                failure ??= message;
              },
            }),
          pendingHidden,
        );
        reportMoveBatch(
          { toast, history, revalidate },
          {
            landed,
            total: items.length,
            destination: destinationLabel(scope, destFolderId),
            forward: (l) => scopeActionsRef.current.get(scopeId)?.performMove(l.item, destFolderId) ?? Promise.resolve(false),
            back: (l) =>
              scopeActionsRef.current.get(scopeId)?.performMove({ ...l.item, parentFolderId: destFolderId }, l.folderId) ??
              Promise.resolve(false),
            failure: items.length === 1 ? failure : undefined,
          },
        );
      })();
    },
    [scopeActionsMap, driveScopes, toast, history, revalidate, pendingHidden],
  );

  const moveDestinationsFor = useCallback(
    (item: DriveItem): DriveTreeScope[] => {
      const home = driveScopes.find((s) => s.items.some((i) => i.id === item.id));
      return driveScopes.filter((s) => {
        if (s.id === "mine" || isVirtualSpace(s.id)) return false;
        // Items under a typed root stay in that root's drive.
        if (home?.rootFolderId && s.id !== home.id) return false;
        const kind = scopeKindOf(s.id);
        // A system folder keeps its workspace, so project and offering drives are out.
        if (
          item.type === "folder" &&
          (item as { folderType?: string | null }).folderType &&
          (kind === "project" || kind === "projects-group" || kind === "education-group")
        ) {
          return false;
        }
        // Files/forms move by folderPageId (no workspace change), so restrict
        // them to the Lab-workspace drives. Docs/folders can also move into
        // project/offering workspaces.
        const isDocOrFolder = isPageItem(item);
        if (!isDocOrFolder) {
          // Files/forms: Lab workspace only (no project/offering cross-move).
          return kind !== "project" && kind !== "projects-group" && kind !== "education-group";
        }
        // Docs/folders: include the synthetic group scopes so the picker shows
        // individual project/offering folders as drillable destinations.
        // The bare group ROOT is exposed as a drive row but the move handler
        // requires a specific project/offering folder to be selected.
        return true;
      });
    },
    [driveScopes],
  );

  // One item to a drive and folder, with no confirm and no reporting: the
  // batch below owns both. `onError` gets the reason a move was refused.
  const moveItemToScope = useCallback(
    async (
      item: DriveItem,
      sourceScopeId: string,
      destScopeId: string,
      destFolderPageId: string | null,
      onError?: (message: string) => void,
    ): Promise<boolean> => {
      const destScope = driveScopes.find((s) => s.id === destScopeId);
      if (!destScope) return false;
      const src = driveScopes.find((s) => s.id === sourceScopeId);
      const srcWs = src
        ? scopeDest(src, viewerId)
        : { workspaceType: "Lab" as const, workspaceId: null, root: null };

      // For the synthetic group scopes (projects/education), the destFolderPageId
      // IS the project/offering id when the user picks a synthetic top-level folder.
      // Resolve the workspace from the picked folder id so the move endpoint
      // receives the correct workspaceType/workspaceId rather than treating the
      // project/offering id as a real parentPageId.
      const destKind = scopeKindOf(destScopeId);
      let d: { workspaceType: "Lab" | "Project" | "EducationOffering"; workspaceId: string | null; root: string | null };
      let parent: string | null;
      if (destKind === "projects-group" || destKind === "education-group") {
        // Dropped at the bare group root — can't resolve a specific workspace.
        const wsId = destFolderPageId ? resolveWorkspaceId(destScope.items, destFolderPageId) : null;
        if (!destFolderPageId || !wsId) {
          onError?.("Select a project or offering to move into");
          return false;
        }
        // Whether the pick was ON the synthetic root (→ null parent) or inside a
        // real sub-folder (→ keep real parentPageId).
        const destNode = destScope.items.find((it) => it.id === destFolderPageId);
        const realParent = destNode?.parentFolderId === null ? null : destFolderPageId;
        d = {
          workspaceType: destKind === "projects-group" ? "Project" : "EducationOffering",
          workspaceId: wsId,
          root: null,
        };
        parent = realParent;
      } else {
        d = scopeDest(destScope, viewerId) as typeof d;
        parent = destFolderPageId ?? d.root;
      }

      // No-op if it's already there.
      if (destScopeId === sourceScopeId && (parent ?? null) === (item.parentFolderId ?? null)) return true;

      let res: Response;
      if (isPageItem(item)) {
        const crossWs = d.workspaceType !== srcWs.workspaceType || d.workspaceId !== srcWs.workspaceId;
        res = await fetch(`/api/pages/${item.id}/move`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentPageId: parent,
            ...(crossWs ? { workspaceType: d.workspaceType, workspaceId: d.workspaceId } : {}),
          }),
        });
      } else {
        res = await fetch("/api/drive/move", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemType: item.type, itemId: item.id, destFolderPageId: parent }),
        });
      }
      if (!res.ok) {
        const reason = await driveErrorFrom(res);
        if (reason) onError?.(reason);
      }
      return res.ok;
    },
    [driveScopes, viewerId],
  );
  const moveItemToScopeRef = useRef(moveItemToScope);
  moveItemToScopeRef.current = moveItemToScope;

  // Move a selection to another drive (or another folder of one): confirm a
  // change of audience, hide the rows, move them one by one, then report once.
  // Toasting per item stacked a notification (and fired a full tree revalidate)
  // for every file in the selection, and left as many single-item Undos as
  // there were items.
  const moveBatchToScope = useCallback(
    async (items: DriveItem[], sourceScopeId: string, destScopeId: string, destFolderId: string | null) => {
      if (isVirtualSpace(sourceScopeId) || isVirtualSpace(destScopeId)) {
        toast.error("Open the document to change where it lives");
        return;
      }
      const destScope = driveScopes.find((s) => s.id === destScopeId);
      if (!destScope) return;
      const destLabel = destScope.label;
      if (destScopeId !== sourceScopeId) {
        const ok = await dialog.confirm(
          items.length === 1
            ? {
                title: `Move to ${destLabel}?`,
                description: `"${items[0].title || "Untitled"}" will move to ${destLabel} and become visible to ${scopeAudience(destScopeId)}.`,
                confirmLabel: "Move",
              }
            : {
                title: `Move ${itemCount(items.length)}?`,
                description: `They'll move to ${destLabel} and become visible to ${scopeAudience(destScopeId)}.`,
                confirmLabel: "Move",
              },
        );
        if (!ok) return;
      }
      let failure: string | undefined;
      const landed = await runHiddenMoveBatch(
        items,
        (item) =>
          moveItemToScope(item, sourceScopeId, destScopeId, destFolderId, (message) => {
            failure ??= message;
          }),
        pendingHidden,
      );
      reportMoveBatch(
        { toast, history, revalidate },
        {
          landed,
          total: items.length,
          destination: destinationLabel(destScope, destFolderId),
          forward: (l: Landed<DriveItem>) =>
            moveItemToScopeRef.current(l.item, sourceScopeId, destScopeId, destFolderId),
          // A move out of My Drive is one-way: the endpoint refuses a Member
          // destination, so an Undo could only fail.
          back:
            scopeKindOf(sourceScopeId) === "mine"
              ? null
              : (l: Landed<DriveItem>) =>
                  moveItemToScopeRef.current(
                    { ...l.item, parentFolderId: destFolderId },
                    destScopeId,
                    sourceScopeId,
                    l.folderId,
                  ),
          failure: items.length === 1 ? failure : undefined,
        },
      );
    },
    [driveScopes, moveItemToScope, dialog, toast, history, revalidate, pendingHidden],
  );

  // Open the hybrid destination picker over every drive the item(s) may move to
  // and resolve with the chosen destination (or null on cancel). The scope id is
  // the picker's driveId, so we return it verbatim.
  const pickMoveDestination = useCallback(
    (item: DriveItem, sourceScopeId: string, heading: string): Promise<{ scopeId: string; folderId: string | null } | null> => {
      const scopes = moveDestinationsFor(item);
      if (scopes.length === 0) {
        toast.error("There's nowhere else to move this");
        return Promise.resolve(null);
      }
      const banned =
        item.type === "folder"
          ? folderAndDescendants(driveScopes.find((s) => s.id === sourceScopeId)?.items ?? [], item.id)
          : undefined;
      const { drives, folders } = buildPickerRows(scopes);
      const sourceRoot = driveScopes.find((s) => s.id === sourceScopeId)?.rootFolderId ?? null;
      const currentFolder = (item.parentFolderId ?? null) === sourceRoot ? null : (item.parentFolderId ?? null);
      const currentDest: Destination = { driveId: sourceScopeId, folderId: currentFolder };
      return new Promise((resolve) => {
        movePickerResolve.current = resolve as (d: Destination | null) => void;
        setMovePicker({
          heading,
          drives,
          folders,
          disabledFolderIds: banned,
          disabledDest: currentDest,
          initial: currentDest,
        });
      }).then((dest) =>
        dest ? { scopeId: (dest as Destination).driveId, folderId: (dest as Destination).folderId } : null,
      );
    },
    [driveScopes, moveDestinationsFor, toast],
  );

  const requestMoveCrossDrive = useCallback(
    async (sourceScopeId: string, item: DriveItem) => {
      const dest = await pickMoveDestination(item, sourceScopeId, `Move "${item.title || "Untitled"}"`);
      if (dest) await moveBatchToScope([item], sourceScopeId, dest.scopeId, dest.folderId);
    },
    [pickMoveDestination, moveBatchToScope],
  );

  // Bulk move: pick a destination once, move everything there, report once.
  const onBulkMove = useCallback(
    async (items: DriveItem[]) => {
      if (items.length === 0 || !effectiveScopeId) return;
      if (isVirtualSpace(effectiveScopeId)) {
        toast.error("Open the document to change where it lives");
        return;
      }
      const dest = await pickMoveDestination(items[0], effectiveScopeId, `Move ${itemCount(items.length)}`);
      if (dest) await moveBatchToScope(items, effectiveScopeId, dest.scopeId, dest.folderId);
    },
    [pickMoveDestination, moveBatchToScope, effectiveScopeId, toast],
  );

  // Cross-drive drag-and-drop: dropping an item onto a drive row (column-view
  // scope column) moves it to that drive's top level, confirming the re-scope.
  const onMoveToScope = useCallback(
    (sourceScopeId: string, destScopeId: string, items: DriveItem[]) => {
      if (items.length === 0) return;
      void moveBatchToScope(items, sourceScopeId, destScopeId, null);
    },
    [moveBatchToScope],
  );

  return { movePicker, resolveMovePicker, onMove, onBulkMove, onMoveToScope, requestMoveCrossDrive };
}
