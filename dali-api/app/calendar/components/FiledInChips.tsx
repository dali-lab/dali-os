import { Folder, Plus, X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Tooltip } from "~/components/ui/floating/Tooltip";
import { destinationKey } from "~/components/drive/picker-multi";
import { MAX_FILING_LINKS, type FilingPlace } from "~/calendar/components/meeting-note";

export type FilingSuggestionChip = { groupId: string; label: string; reason: string };

/** The notebook's places: the primary first, then links. In "existing" mode the
 *  notebook already has its own location, so every chip is a link. For a
 *  whiteboard with no note there is one place and nothing to rank. */
export function FiledInChips({
  places,
  existingNotebook,
  boardOnly = false,
  suggestions,
  labelClass,
  onPickSuggestion,
  onMakePrimary,
  onRemove,
  onAdd,
}: {
  places: FilingPlace[];
  existingNotebook: boolean;
  boardOnly?: boolean;
  suggestions: FilingSuggestionChip[];
  labelClass: string;
  onPickSuggestion: (groupId: string) => void;
  onMakePrimary: (place: FilingPlace) => void;
  onRemove: (place: FilingPlace) => void;
  onAdd: () => void;
}) {
  const linkCount = existingNotebook ? places.length : Math.max(places.length - 1, 0);
  return (
    <div>
      <span className={labelClass}>Filed in</span>
      {suggestions.length > 0 && (
        <ul aria-label="Suggested places" className="mb-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <li key={s.groupId}>
              <button
                type="button"
                onClick={() => onPickSuggestion(s.groupId)}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted/60"
              >
                <Plus className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">
                  Suggested: {s.label} · {s.reason}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {places.length > 0 && (
        <ul aria-label="Filed in" className="mb-2 flex flex-col gap-1">
          {places.map((place, i) => (
            <li
              key={destinationKey(place.dest)}
              data-testid="filed-in-chip"
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 py-1 pl-2 pr-1 text-sm"
            >
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-foreground" title={place.path}>
                {place.path}
              </span>
              {boardOnly ? null : i === 0 && !existingNotebook ? (
                <span className="shrink-0 rounded bg-accent-coral/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent-coral">
                  Primary
                </span>
              ) : existingNotebook ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  Link
                </span>
              ) : (
                <Tooltip content="Make primary" placement="top">
                  <button
                    type="button"
                    aria-label={`Make ${place.path} primary`}
                    onClick={() => onMakePrimary(place)}
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                  >
                    Link
                  </button>
                </Tooltip>
              )}
              <IconButton
                label={`Remove ${place.path}`}
                icon={X}
                tooltipSide="top"
                className="shrink-0 p-1"
                onClick={() => onRemove(place)}
              />
            </li>
          ))}
        </ul>
      )}
      {!boardOnly && linkCount > MAX_FILING_LINKS && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          A notebook can have up to {MAX_FILING_LINKS} links. Remove {linkCount - MAX_FILING_LINKS}.
        </p>
      )}
      {places.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">
          {boardOnly
            ? "Nothing chosen. The whiteboard goes in the default Meeting assets folder."
            : existingNotebook
              ? "Optional. Add places to link this notebook from."
              : "Nothing chosen. A new notebook goes in the default Meetings folder."}
        </p>
      )}
      <Button variant="ghost" size="xs" onClick={onAdd} className="-ml-2.5">
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {boardOnly && places.length > 0 ? "Change place…" : "Add a place…"}
      </Button>
    </div>
  );
}
