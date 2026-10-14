import { useEffect, useMemo, useState } from "react";
import { useRevalidator } from "react-router";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import {
  CHOICE_NONE,
  choiceLabel,
  currentChoice,
  planChoiceChange,
  slotChoice,
  type Choice,
  type SlotChoice,
} from "~/components/drive/receiver-options";
import {
  fetchReceiverSlots,
  pathText,
  sendReceiverRequest,
  type ReceiverSlotRow,
} from "~/components/drive/receivers-api";

export type FolderSettingsTarget = { id: string; title: string; folderType?: string | null };

export function FolderSettingsModal({
  open,
  onClose,
  folder,
  slots,
}: {
  open: boolean;
  onClose: () => void;
  folder: FolderSettingsTarget;
  /** Process slots this folder is eligible for (`eligibleSlotsFor`); empty offers only None. */
  slots: SlotChoice[];
}) {
  const toast = useToast();
  const revalidator = useRevalidator();
  const [rows, setRows] = useState<ReceiverSlotRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState<Choice>(CHOICE_NONE);
  const [saving, setSaving] = useState(false);

  const process = slots[0] ?? null;
  useEffect(() => {
    if (!open || !process) return;
    let cancelled = false;
    setLoading(true);
    void fetchReceiverSlots(process.processType, process.processId).then((next) => {
      if (cancelled) return;
      setRows(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, process?.processType, process?.processId]);

  const usable = useMemo(() => (rows ? slots : []), [rows, slots]);
  const initial = useMemo(
    () =>
      currentChoice({
        folderId: folder.id,
        slots: usable,
        holders: Object.fromEntries((rows ?? []).map((r) => [r.folderType, r.folder?.id ?? null])),
      }),
    [folder.id, usable, rows],
  );
  useEffect(() => {
    if (open && !loading) setChoice(initial);
  }, [open, loading, initial]);

  const options = [CHOICE_NONE, ...usable.map(slotChoice)].map((value) => ({
    value: value as Choice,
    label: choiceLabel(value as Choice, usable),
  }));

  const chosenSlot = usable.find((s) => slotChoice(s) === choice);
  const holder = chosenSlot ? rows?.find((r) => r.folderType === chosenSlot.folderType)?.folder : null;
  const movesFiling = !!holder && holder.id !== folder.id;

  async function save() {
    setSaving(true);
    for (const step of planChoiceChange(folder.id, initial, choice, usable)) {
      const res = await sendReceiverRequest(step);
      if (!res.ok) {
        toast.error(res.error);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    void revalidator.revalidate();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="folder-settings-title" disableEscape={saving}>
      <ModalHeader titleId="folder-settings-title" title="Folder settings" subtitle={folder.title || "Untitled folder"} onClose={onClose} />
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">This folder receives</span>
        <Select<Choice>
          value={choice}
          options={options}
          onChange={setChoice}
          disabled={loading || saving}
          ariaLabel="This folder receives"
        />
        {movesFiling && holder && (
          <p className="text-xs text-muted-foreground" data-testid="receiver-current">
            Currently: {pathText(holder.path)}. Switching moves future filing here.
          </p>
        )}
      </div>
      <ModalFooter onCancel={onClose}>
        <Button size="sm" onClick={() => void save()} disabled={loading || saving || choice === initial}>
          Save
        </Button>
      </ModalFooter>
    </Modal>
  );
}
