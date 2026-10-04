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
  folders: { id: string; title: string; parentId: string | null; itemCount?: number }[];
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
    () =>
      destinations.map((d) => ({
        id: d.type === "Lab" ? "lab" : d.id!,
        label: d.label,
        iconEmoji: d.iconEmoji,
        // Picking a drive is what changes who can see the doc, so say so.
        audience: d.type === "Lab" ? "Everyone in the lab" : "Project members",
      })),
    [destinations],
  );
  const folders: PickerFolder[] = useMemo(
    () =>
      destinations.flatMap((d) => {
        const driveId = d.type === "Lab" ? "lab" : d.id!;
        return d.folders.map((f) => ({
          id: f.id,
          driveId,
          parentId: f.parentId,
          title: f.title,
          itemCount: f.itemCount,
        }));
      }),
    [destinations],
  );

  // The page being moved may itself be a folder, in which case neither it nor
  // anything under it is a legal destination. The move endpoint rejects that
  // with a 400 ("can't be moved into its own descendant"), so offering it only
  // buys the user a failed move. Walked from the flat list the picker already
  // holds, so it costs no extra request.
  const disabledFolderIds = useMemo(() => {
    const banned = new Set<string>();
    if (!folders.some((f) => f.id === pageId)) return banned;
    banned.add(pageId);
    // Repeated passes: the flat list isn't in parent-before-child order.
    for (let pass = 0; pass < folders.length; pass++) {
      let grew = false;
      for (const f of folders) {
        if (!banned.has(f.id) && f.parentId && banned.has(f.parentId)) {
          banned.add(f.id);
          grew = true;
        }
      }
      if (!grew) break;
    }
    return banned;
  }, [folders, pageId]);

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
      disabledFolderIds={disabledFolderIds}
      initial={drives.some((d) => d.id === currentKey) ? { driveId: currentKey, folderId: null } : undefined}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
