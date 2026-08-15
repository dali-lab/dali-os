import { useEffect, useMemo, useState } from "react";
import { DestinationPicker } from "~/components/drive/DestinationPicker";
import type { PickerDrive, PickerFolder, Destination } from "~/components/drive/DestinationPicker";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

// "Move to…" picker — pick a destination workspace (Lab-wide or a project you
// can edit) and optionally a folder, then move the doc there. Moving between
// workspaces changes who can see it, so cross-workspace moves confirm first.
// Shares the drill-in/search DestinationPicker with the Drive hub.

type Destination_ = {
  type: "Lab" | "Project";
  id: string | null;
  label: string;
  iconEmoji: string | null;
  folders: { id: string; title: string; parentId: string | null }[];
};

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
  const [destinations, setDestinations] = useState<Destination_[]>([]);
  const [loaded, setLoaded] = useState(false);

  const currentKey = current.type === "Lab" ? "lab" : (current.id ?? "");

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    fetch("/api/move-destinations", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setDestinations(d.destinations ?? []);
        setLoaded(true);
      })
      .catch(() => {
        toast.error("Couldn't load destinations.");
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId]);

  const drives: PickerDrive[] = useMemo(
    () => destinations.map((d) => ({ id: d.type === "Lab" ? "lab" : d.id!, label: d.label, iconEmoji: d.iconEmoji })),
    [destinations],
  );
  const folders: PickerFolder[] = useMemo(
    () =>
      destinations.flatMap((d) => {
        const driveId = d.type === "Lab" ? "lab" : d.id!;
        return d.folders.map((f) => ({ id: f.id, driveId, parentId: f.parentId, title: f.title }));
      }),
    [destinations],
  );

  async function onConfirm(dest: Destination) {
    const selected = destinations.find((d) => (d.type === "Lab" ? "lab" : d.id) === dest.driveId);
    if (!selected) return;
    const isCross = selected.type !== current.type || selected.id !== current.id;
    if (isCross) {
      const leavingProject = current.type === "Project";
      const ok = await dialog.confirm({
        title: `Move “${title}” to ${selected.label}?`,
        description: `People with access where it is now will lose it, and people in ${selected.label} will gain access.${leavingProject ? " Partner and public sharing will be turned off." : ""}`,
        confirmLabel: "Move",
      });
      if (!ok) return;
    }
    const res = await fetch(`/api/pages/${pageId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        workspaceType: selected.type,
        workspaceId: selected.id,
        parentPageId: dest.folderId,
      }),
    })
      .then((r) => r.json())
      .catch(() => ({ error: "Move failed." }));
    if (res?.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`Moved to ${selected.label}.`);
    onMoved?.();
    onClose();
  }

  if (!open || !loaded) return null;

  return (
    <DestinationPicker
      open
      heading={`Move “${title}”`}
      drives={drives}
      folders={folders}
      initial={drives.some((d) => d.id === currentKey) ? { driveId: currentKey, folderId: null } : undefined}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
