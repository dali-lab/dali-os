import { FileText } from "lucide-react";

/**
 * Leading icon for a page/document row: the page's custom `iconEmoji` when set,
 * otherwise a neutral document glyph. Fixed-width slot so titles stay aligned
 * whether or not a row has a custom emoji.
 */
export function PageIcon({ iconEmoji }: { iconEmoji?: string | null }) {
  return (
    <span className="flex w-4 flex-shrink-0 items-center justify-center leading-none" aria-hidden>
      {iconEmoji ? (
        <span className="text-sm">{iconEmoji}</span>
      ) : (
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </span>
  );
}
