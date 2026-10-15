import { useCallback, useEffect, useMemo, useState } from "react";
import { Folder } from "lucide-react";
import { FolderPicker, type Destination } from "~/components/drive/FolderPicker";
import { useDriveDestinations } from "~/components/drive/use-drive-destinations";
import { receiverPickerRows, spaceNoun, topLevelOf } from "~/components/drive/receiver-options";
import {
  fetchReceiverSlots,
  pathText,
  sendReceiverRequest,
  type ReceiverSlotRow,
} from "~/components/drive/receivers-api";
import { Button } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import type { ReceiverFolderType, ReceiverProcessType } from "~/lib/drive-receivers";

export function DriveReceivers({
  processType,
  processId = "",
  title = "Drive folders",
  only,
  className,
}: {
  processType: ReceiverProcessType;
  processId?: string;
  title?: string;
  /** Show just these slots (e.g. the certificate page only owns one of Core's). */
  only?: readonly ReceiverFolderType[];
  className?: string;
}) {
  const toast = useToast();
  const dialog = useDialog();
  const [slots, setSlots] = useState<ReceiverSlotRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<ReceiverSlotRow | null>(null);

  const reload = useCallback(async () => {
    const next = await fetchReceiverSlots(processType, processId || null);
    setSlots(next);
    setFailed(next === null);
  }, [processType, processId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const destinations = useDriveDestinations({
    enabled: picking !== null,
    onError: () => {
      toast.error("Couldn't load folders.");
      setPicking(null);
    },
  });
  const pickerRows = useMemo(
    () => receiverPickerRows(destinations.rows, processType, processId || null),
    [destinations.rows, processType, processId],
  );
  const topLevel = useMemo(() => topLevelOf(pickerRows), [pickerRows]);

  const visible = (slots ?? []).filter((s) => !only || only.includes(s.folderType));
  const space = spaceNoun(processType);

  async function choose(slot: ReceiverSlotRow, dest: Destination) {
    if (!dest.folderId) return;
    const res = await sendReceiverRequest({
      intent: "set",
      processType,
      ...(processId ? { processId } : {}),
      folderType: slot.folderType,
      folderId: dest.folderId,
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setPicking(null);
    await reload();
  }

  async function clear(slot: ReceiverSlotRow) {
    const ok = await dialog.confirm({
      title: `Clear the ${slot.label.toLowerCase()} folder?`,
      description: `New items will file at the top level of ${space} instead. Items already filed stay where they are.`,
      confirmLabel: "Clear",
    });
    if (!ok) return;
    setBusy(true);
    const res = await sendReceiverRequest({
      intent: "clear",
      processType,
      ...(processId ? { processId } : {}),
      folderType: slot.folderType,
    });
    setBusy(false);
    if (!res.ok) toast.error(res.error);
    await reload();
  }

  return (
    <div className={className ?? "border-t border-border pt-5 mt-2"}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Where this process files new items. Leave a slot empty to file at the top level of its space.
      </p>

      {failed ? (
        <p className="mt-3 text-xs text-destructive">Couldn&rsquo;t load the folder settings.</p>
      ) : slots === null ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading…</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {visible.map((slot) => (
            <li key={slot.folderType} className="flex flex-col gap-1.5" data-testid={`receiver-row-${slot.folderType}`}>
              <span className="text-xs font-medium text-foreground">{slot.label}</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    {slot.folder
                      ? pathText(slot.folder.path)
                      : `Not set, files go to the ${space} top level`}
                  </span>
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button variant="secondary" size="xs" disabled={busy} onClick={() => setPicking(slot)}>
                    Change
                  </Button>
                  {slot.folder && (
                    <Button variant="ghost" size="xs" disabled={busy} onClick={() => void clear(slot)}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {picking && destinations.status === "ready" && (
        <FolderPicker
          open
          heading={`Folder for ${picking.label.toLowerCase()}`}
          drives={pickerRows.drives}
          folders={pickerRows.folders}
          disabledDest={topLevel}
          preferFolderType={picking.folderType}
          confirmLabel="Use this folder"
          pendingLabel="Folder:"
          emptyText="No folders in this space yet. Make one in the Drive first."
          onClose={() => setPicking(null)}
          onConfirm={(dest) => choose(picking, dest)}
        />
      )}
    </div>
  );
}
