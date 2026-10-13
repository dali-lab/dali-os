import { useCallback, useEffect, useMemo } from "react";
import { FolderPicker, destinationPath, type Destination } from "~/components/drive/FolderPicker";
import { pickDrives } from "~/components/drive/picker-rows";
import { descendantFolderIds, needsAudienceConfirm, resolveMoveTarget } from "~/components/drive/move-target";
import { useDriveDestinations } from "~/components/drive/use-drive-destinations";
import { createShortcutRequest, placePageRequest, usePlacements } from "~/components/drive/shortcut-api";
import { destinationForPlace, planPlacement, toServerDest } from "~/components/drive/file-in";
import { ACTION_TOAST_MS, filedToast, pathLabel, shortcutToast } from "~/components/drive/action-toast";
import { filingEntry, shortcutEntry, type FileInResult } from "~/components/drive/filing-history";
import { useDriveHistoryContext } from "~/components/drive/use-drive-history";
import type { MultiResult } from "~/components/drive/picker-multi";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

export type FileInTarget = { id: string; title: string; isFolder: boolean };

/**
 * The two ways to put a page somewhere else without losing where it is.
 * `multi` ("File in…") picks several locations with one primary; `single`
 * ("Add shortcut to…") adds one shortcut. Opens once the destinations and the
 * page's current locations have both loaded.
 */
export function FileInPicker({
  target,
  mode,
  onClose,
  onDone,
}: {
  target: FileInTarget;
  mode: "multi" | "single";
  onClose: () => void;
  /** Called after anything was written, so the host can reload the listing. */
  onDone: (result: FileInResult) => void;
}) {
  const toast = useToast();
  const history = useDriveHistoryContext();
  const dialog = useDialog();
  const { rows, status } = useDriveDestinations({
    enabled: true,
    onError: () => {
      toast.error("Couldn't load folders.");
      onClose();
    },
  });
  const { placements, loading } = usePlacements(target.id);

  const filable = useMemo(() => pickDrives(rows, (id) => id !== "mine"), [rows]);
  const disabledFolderIds = useMemo(
    () => (target.isFolder ? descendantFolderIds(filable, target.id) : undefined),
    [filable, target.id, target.isFolder],
  );
  const currentPrimary = useMemo(
    () => (placements ? destinationForPlace(placements.primary, filable) : null),
    [placements, filable],
  );
  const lockedDestinations = useMemo(
    () =>
      (placements?.shortcuts ?? []).flatMap((s) => {
        const dest = destinationForPlace(s, filable);
        return dest ? [dest] : [];
      }),
    [placements, filable],
  );

  const pathOf = useCallback(
    (dest: Destination) =>
      pathLabel(
        destinationPath(
          dest,
          new Map(filable.drives.map((d) => [d.id, d])),
          new Map(filable.folders.map((f) => [f.id, f])),
        ),
      ),
    [filable],
  );

  const ready = status === "ready" && !loading;
  const unsupported = ready && mode === "multi" && (placements === null || currentPrimary === null);

  useEffect(() => {
    if (!unsupported) return;
    toast.error("This can only be moved or given a shortcut from here. Use Add shortcut to…");
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsupported]);

  const confirmMulti = useCallback(
    async (result: MultiResult) => {
      if (!placements || !currentPrimary) return;
      const plan = planPlacement({ result, rows: filable, currentPrimary, locked: lockedDestinations });
      if (!plan.payload) {
        toast.error("Pick a project or offering to file into.");
        return;
      }
      if (!plan.primaryChanged && plan.addedDestinations.length === 0) {
        toast.info("Nothing to change.");
        onClose();
        return;
      }
      const primary = result.destinations[result.primaryIndex];
      if (plan.primaryChanged) {
        const moveTo = resolveMoveTarget(primary, filable);
        if (
          moveTo &&
          needsAudienceConfirm(moveTo, { type: placements.primary.workspaceType, id: placements.primary.workspaceId })
        ) {
          const ok = await dialog.confirm({
            title: `Move “${target.title || "Untitled"}” to ${moveTo.label}?`,
            description: `People with access where it is now will lose it, and people in ${moveTo.label} will gain access.`,
            confirmLabel: "Move",
          });
          if (!ok) return;
        }
      }
      const res = await placePageRequest(target.id, plan.payload.destinations, plan.payload.primaryIndex);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const createdShortcutIds = res.shortcutIds ?? [];
      const entry = history?.record(
        filingEntry({
          pageId: target.id,
          previousPrimary: placements.primary,
          primaryChanged: plan.primaryChanged,
          destinations: plan.payload.destinations,
          primaryIndex: plan.payload.primaryIndex,
          createdShortcutIds,
        }),
      );
      toast.success(
        filedToast({
          title: target.title,
          destination: pathOf(primary),
          shortcutDestinations: plan.addedDestinations.map(pathOf),
          declined: res.declined ?? 0,
        }),
        {
          duration: ACTION_TOAST_MS,
          actions: entry ? [{ label: "Undo", onClick: () => void history?.undoEntry(entry) }] : [],
        },
      );
      onDone({ previousPrimary: placements.primary, createdShortcutIds });
      onClose();
    },
    [placements, currentPrimary, filable, lockedDestinations, pathOf, target, dialog, toast, history, onDone, onClose],
  );

  const confirmSingle = useCallback(
    async (dest: Destination) => {
      const server = toServerDest(dest, filable);
      if (!server) {
        toast.error("Pick a project or offering to put the shortcut in.");
        return;
      }
      const res = await createShortcutRequest(target.id, server);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const entry = res.created ? history?.record(shortcutEntry({ pageId: target.id, dest: server, shortcutId: res.shortcutId })) : undefined;
      toast.success(
        shortcutToast({
          created: res.created,
          title: target.title,
          destination: pathOf(dest),
          grantDeclined: res.grantDeclined,
        }),
        {
          duration: ACTION_TOAST_MS,
          actions: entry ? [{ label: "Undo", onClick: () => void history?.undoEntry(entry) }] : [],
        },
      );
      if (res.created) onDone({ previousPrimary: placements?.primary ?? null, createdShortcutIds: [res.shortcutId] });
      onClose();
    },
    [filable, pathOf, target, placements, toast, history, onDone, onClose],
  );

  const common = {
    open: ready && !unsupported,
    onClose,
    drives: filable.drives,
    folders: filable.folders,
    disabledFolderIds,
    initial: currentPrimary ?? undefined,
    emptyText: "There's nowhere to file this.",
  };

  if (mode === "multi") {
    return (
      <FolderPicker
        {...common}
        mode="multi"
        heading={`File “${target.title || "Untitled"}” in…`}
        confirmLabel="File"
        initialDestinations={currentPrimary ? [currentPrimary, ...lockedDestinations] : []}
        lockedDestinations={lockedDestinations}
        onConfirm={confirmMulti}
      />
    );
  }
  return (
    <FolderPicker
      {...common}
      heading={`Add a shortcut to “${target.title || "Untitled"}”`}
      confirmLabel="Add shortcut"
      pendingLabel="Add to:"
      intoVerb="Add shortcut to"
      disabledDest={currentPrimary}
      onConfirm={confirmSingle}
    />
  );
}
