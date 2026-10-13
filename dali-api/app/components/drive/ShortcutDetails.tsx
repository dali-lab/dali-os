import { useCallback, useState } from "react";
import { Lock, X } from "lucide-react";
import { useRevalidator } from "react-router";
import type { DriveItem } from "~/lib/drive.server";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import { LocationLink } from "~/components/drive/LocationLink";
import { DetailFact } from "~/components/drive/DetailFact";
import { locateFolder, type ItemLocation } from "~/components/drive/location";
import { placeLabel, type ShortcutPlace } from "~/components/drive/file-in";
import { SHORTCUT_REMOVED_TOAST } from "~/components/drive/action-toast";
import { deleteShortcutRequest, swapPrimaryRequest, usePlacements } from "~/components/drive/shortcut-api";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

type ShortcutItem = Extract<DriveItem, { type: "shortcut" }>;

/** The "Original" fact for a shortcut: where the original lives, or why it can't be shown. */
export function OriginalValue({
  item,
  location,
  onNavigate,
}: {
  item: ShortcutItem;
  location: ItemLocation | null;
  onNavigate: (scopeId: string, folderId: string | null) => void;
}) {
  if (item.originalInTrash) {
    return <span data-testid="original-in-trash">Original in trash</span>;
  }
  if (!item.canOpen) {
    return (
      <span data-testid="original-no-access" className="inline-flex items-center gap-1 text-muted-foreground">
        <Lock className="h-3 w-3" aria-hidden />
        No access
      </span>
    );
  }
  if (!location) return <span data-testid="original-title">{item.title}</span>;
  return <LocationLink location={location} onNavigate={onNavigate} />;
}

/** The "Also in" list: each shortcut's folder, with Make primary and remove. */
export function AlsoInList({
  places,
  busy,
  navigable,
  onOpen,
  onMakePrimary,
  onRemove,
}: {
  places: ShortcutPlace[];
  busy: boolean;
  /** Whether a place's folder can be opened in the Drive from here. */
  navigable: (place: ShortcutPlace) => boolean;
  onOpen: (place: ShortcutPlace) => void;
  onMakePrimary: (place: ShortcutPlace) => void;
  onRemove: (place: ShortcutPlace) => void;
}) {
  return (
    <ul data-testid="also-in" className="flex flex-col gap-1.5">
      {places.map((place) => {
        const label = placeLabel(place);
        return (
          <li key={place.shortcutId} data-testid="also-in-row" className="flex items-start gap-1.5">
            {navigable(place) ? (
              <button
                type="button"
                onClick={() => onOpen(place)}
                className="min-w-0 flex-1 text-left hover:underline"
              >
                {label}
              </button>
            ) : (
              <span className="min-w-0 flex-1">{label}</span>
            )}
            <button
              type="button"
              disabled={busy}
              aria-label={`Make ${label} the primary location`}
              onClick={() => onMakePrimary(place)}
              className="shrink-0 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Make primary
            </button>
            <button
              type="button"
              disabled={busy}
              aria-label={`Remove the shortcut in ${label}`}
              onClick={() => onRemove(place)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The "Also in" fact for a page: loads where it is also filed when the pane
 * opens, and renders nothing when it is filed nowhere else.
 */
export function AlsoInSection({
  page,
  scopes,
  onNavigate,
}: {
  page: { id: string; title: string };
  scopes: DriveTreeScope[];
  onNavigate: (scopeId: string, folderId: string | null) => void;
}) {
  const { placements, reload } = usePlacements(page.id);
  const dialog = useDialog();
  const toast = useToast();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);

  const changed = useCallback(() => {
    reload();
    void revalidator.revalidate();
  }, [reload, revalidator]);

  const remove = useCallback(
    async (place: ShortcutPlace) => {
      const label = placeLabel(place);
      const ok = await dialog.confirm({
        title: `Remove the shortcut in ${label}?`,
        description: "Only the shortcut goes. The original stays where it is.",
        tone: "destructive",
        confirmLabel: "Remove",
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await deleteShortcutRequest(place.shortcutId);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(body.error ?? "Couldn't remove the shortcut");
          return;
        }
        toast.success(SHORTCUT_REMOVED_TOAST);
        changed();
      } finally {
        setBusy(false);
      }
    },
    [dialog, toast, changed],
  );

  const makePrimary = useCallback(
    async (place: ShortcutPlace) => {
      const label = placeLabel(place);
      const ok = await dialog.confirm({
        title: `Make ${label} the primary location?`,
        description: `“${page.title || "Untitled"}” moves there, and a shortcut stays where it is now. People with access to ${label} can open it.`,
        confirmLabel: "Make primary",
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await swapPrimaryRequest(page.id, place.shortcutId);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`Primary location is now ${label}.`);
        changed();
      } finally {
        setBusy(false);
      }
    },
    [dialog, toast, changed, page],
  );

  const places = placements?.shortcuts ?? [];
  if (places.length === 0) return null;
  return (
    <DetailFact
      label="Also in"
      value={
        <AlsoInList
          places={places}
          busy={busy}
          navigable={(place) => locateFolder(scopes, place.folderId) !== null}
          onOpen={(place) => {
            const where = locateFolder(scopes, place.folderId);
            if (where) onNavigate(where.scopeId, where.folderId);
          }}
          onMakePrimary={makePrimary}
          onRemove={remove}
        />
      }
    />
  );
}
