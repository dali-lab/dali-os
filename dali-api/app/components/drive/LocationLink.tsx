import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import type { ItemLocation } from "~/components/drive/location";

/** `Space ▸ Folder ▸ …` for a flat listing; clicking opens the containing folder. */
export function LocationLink({
  location,
  onNavigate,
}: {
  location: ItemLocation | null;
  onNavigate: (scopeId: string, folderId: string | null) => void;
}) {
  if (!location) return <span aria-hidden="true" />;
  return (
    <button
      type="button"
      data-testid="drive-location"
      title={location.path}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(location.scopeId, location.folderId);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="block min-w-0 max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
    >
      {[location.scopeLabel, ...location.folders.map((f) => f.title)].map((label, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight aria-hidden="true" className="mx-0.5 inline h-3 w-3 align-[-2px] opacity-60" />}
          {label}
        </Fragment>
      ))}
    </button>
  );
}
