import { useEffect, useMemo, useState } from "react";
import { useRevalidator } from "react-router";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { useToast } from "~/components/ui/toast";
import {
  CHOICE_NONE,
  currentChoice,
  planChoiceChange,
  slotChoice,
  type MeetingsOption,
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
  meetings,
}: {
  open: boolean;
  onClose: () => void;
  folder: FolderSettingsTarget;
  meetings: MeetingsOption;
}) {
  const toast = useToast();
  const revalidator = useRevalidator();
  const [rows, setRows] = useState<ReceiverSlotRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  const { slot, space } = meetings;
  const slots = useMemo(() => [slot], [slot]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void fetchReceiverSlots(slot.processType, slot.processId).then((next) => {
      if (cancelled) return;
      setRows(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, slot.processType, slot.processId]);

  const holder = rows?.find((r) => r.folderType === slot.folderType)?.folder ?? null;
  const initial = useMemo(
    () => currentChoice({ folderId: folder.id, slots, holders: { [slot.folderType]: holder?.id ?? null } }),
    [folder.id, slots, slot.folderType, holder?.id],
  );
  useEffect(() => {
    if (open && !loading) setChecked(initial !== CHOICE_NONE);
  }, [open, loading, initial]);

  const choice = checked ? slotChoice(slot) : CHOICE_NONE;
  const movesFiling = checked && !!holder && holder.id !== folder.id;

  async function save() {
    setSaving(true);
    for (const step of planChoiceChange(folder.id, initial, choice, slots)) {
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
        <Checkbox
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          disabled={loading || saving}
          label={`New meeting notebooks for ${space} file here`}
        />
        {movesFiling && holder && (
          <p className="text-xs text-muted-foreground" data-testid="receiver-current">
            Currently: {pathText(holder.path)}. Saving moves future filing here.
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
