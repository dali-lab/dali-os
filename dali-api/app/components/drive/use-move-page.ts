import { useCallback, useMemo } from "react";
import type { Destination } from "~/components/drive/FolderPicker";
import { pickDrives, type PickerRows } from "~/components/drive/picker-rows";
import {
  descendantFolderIds,
  moveInitial,
  needsAudienceConfirm,
  resolveMoveTarget,
  type MoveCurrent,
} from "~/components/drive/move-target";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

/** Everything a `FolderPicker` needs to move one page, and the move itself:
 *  confirms an audience change, POSTs `/api/pages/:id/move`, toasts. Spread
 *  `pickerProps` onto the picker. */
export function useMovePage({
  pageId,
  title,
  current,
  rows,
  onMoved,
}: {
  pageId: string;
  title: string;
  current: MoveCurrent;
  rows: PickerRows;
  /** Called after a successful move; close the picker here. */
  onMoved: () => void;
}) {
  const dialog = useDialog();
  const toast = useToast();

  // The move endpoint refuses My Drive as a destination.
  const movable = useMemo(() => pickDrives(rows, (id) => id !== "mine"), [rows]);
  const disabledFolderIds = useMemo(() => descendantFolderIds(movable, pageId), [movable, pageId]);
  const { type: currentType, id: currentId } = current;
  const initial = useMemo(
    () => moveInitial({ type: currentType, id: currentId }, movable),
    [currentType, currentId, movable],
  );

  const onConfirm = useCallback(
    async (dest: Destination) => {
      const target = resolveMoveTarget(dest, movable);
      if (!target) {
        toast.error("Select a project or offering to move into");
        return;
      }
      if (needsAudienceConfirm(target, current)) {
        const leavingProject = current.type === "Project";
        const ok = await dialog.confirm({
          title: `Move “${title}” to ${target.label}?`,
          description: `People with access where it is now will lose it, and people in ${target.label} will gain access.${leavingProject ? " Partner and public sharing will be turned off." : ""}`,
          confirmLabel: "Move",
        });
        if (!ok) return;
      }
      const res = await fetch(`/api/pages/${pageId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          workspaceType: target.workspaceType,
          workspaceId: target.workspaceId,
          parentPageId: target.parentPageId,
        }),
      })
        .then((r) => r.json())
        .catch(() => ({ error: "Move failed." }));
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Moved to ${target.label}.`);
      onMoved();
    },
    [movable, current, dialog, toast, title, pageId, onMoved],
  );

  return {
    pickerProps: {
      drives: movable.drives,
      folders: movable.folders,
      disabledFolderIds,
      initial,
      onConfirm,
    },
  };
}
