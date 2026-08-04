import { useEffect, useState } from "react";
import { Modal, ModalHeader } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { SelectMenu, type SelectMenuOption } from "~/components/ui/SelectMenu";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

// "Move to…" picker — pick a destination workspace (Lab-wide or a project you
// can edit) and optionally a folder, then move the doc there. Moving between
// workspaces changes who can see it, so cross-workspace moves confirm first.

type Destination = {
  type: "Lab" | "Project";
  id: string | null;
  label: string;
  iconEmoji: string | null;
  folders: { id: string; title: string }[];
};

const SELECT_CLASS =
  "inline-flex w-full items-center justify-between gap-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/40";

export function MoveToDialog({
  pageId,
  title,
  current,
  open,
  onClose,
  onMoved,
}: {
  pageId: string;
  title: string;
  current: { type: string; id: string | null };
  open: boolean;
  onClose: () => void;
  onMoved?: () => void;
}) {
  const dialog = useDialog();
  const toast = useToast();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destKey, setDestKey] = useState<string>("");
  const [folderId, setFolderId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentKey = current.type === "Lab" ? "lab" : (current.id ?? "");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFolderId("");
    fetch("/api/move-destinations", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const dests: Destination[] = d.destinations ?? [];
        setDestinations(dests);
        const firstOther = dests.find((x) => (x.type === "Lab" ? "lab" : x.id) !== currentKey);
        setDestKey(firstOther ? (firstOther.type === "Lab" ? "lab" : firstOther.id!) : "");
      })
      .catch(() => setError("Couldn't load destinations."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId]);

  const selectedDest = destinations.find((d) => (d.type === "Lab" ? "lab" : d.id) === destKey);

  const destOptions: SelectMenuOption<string>[] = destinations.map((d) => {
    const key = d.type === "Lab" ? "lab" : d.id!;
    return {
      value: key,
      label: d.label,
      disabled: key === currentKey,
      description: key === currentKey ? "Where it is now" : undefined,
    };
  });
  const folderOptions: SelectMenuOption<string>[] = [
    { value: "", label: "No folder (top level)" },
    ...(selectedDest?.folders ?? []).map((f) => ({ value: f.id, label: f.title })),
  ];

  async function doMove() {
    if (!selectedDest) return;
    const isCross = selectedDest.type !== current.type || selectedDest.id !== current.id;
    if (isCross) {
      const leavingProject = current.type === "Project";
      const ok = await dialog.confirm({
        title: `Move “${title}” to ${selectedDest.label}?`,
        description: `People with access where it is now will lose it, and people in ${selectedDest.label} will gain access.${leavingProject ? " Partner and public sharing will be turned off." : ""}`,
        confirmLabel: "Move",
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/pages/${pageId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        workspaceType: selectedDest.type,
        workspaceId: selectedDest.id,
        parentPageId: folderId || null,
      }),
    })
      .then((r) => r.json())
      .catch(() => ({ error: "Move failed." }));
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    toast.success(`Moved to ${selectedDest.label}.`);
    onMoved?.();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="move-to-title"
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-md w-full p-5 sm:p-6 my-auto"
    >
      <ModalHeader titleId="move-to-title" title={`Move “${title}”`} onClose={onClose} />

      {error && (
        <p className="mb-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Destination</span>
          <SelectMenu
            value={destKey}
            options={destOptions}
            ariaLabel="Destination"
            buttonClassName={SELECT_CLASS}
            onChange={(v) => {
              setDestKey(v);
              setFolderId("");
            }}
          />
        </label>

        {selectedDest && selectedDest.folders.length > 0 && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted-foreground">Folder (optional)</span>
            <SelectMenu
              value={folderId}
              options={folderOptions}
              ariaLabel="Folder"
              buttonClassName={SELECT_CLASS}
              onChange={setFolderId}
            />
          </label>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-5">
        <button type="button" onClick={onClose} className={buttonClasses("secondary", "sm")}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !selectedDest}
          onClick={() => void doMove()}
          className={buttonClasses("primary", "sm")}
        >
          Move
        </button>
      </div>
    </Modal>
  );
}
