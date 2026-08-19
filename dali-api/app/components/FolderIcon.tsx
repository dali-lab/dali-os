import { Folder } from "lucide-react";

/**
 * Leading icon for a folder (e.g. a Drive folder ancestor in a breadcrumb): the
 * folder's custom `iconEmoji` when set, otherwise a neutral folder glyph. Fixed-
 * width slot so titles stay aligned. Mirrors PageIcon, but folders fall back to a
 * folder glyph instead of a document one — using PageIcon made folders read as
 * documents in breadcrumb trails.
 */
export function FolderIcon({ iconEmoji }: { iconEmoji?: string | null }) {
  return (
    <span className="flex w-4 flex-shrink-0 items-center justify-center leading-none" aria-hidden>
      {iconEmoji ? (
        <span className="text-sm">{iconEmoji}</span>
      ) : (
        <Folder className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </span>
  );
}
