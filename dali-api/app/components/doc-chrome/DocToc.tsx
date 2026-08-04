import { List } from "lucide-react";
import type { TocHeading } from "~/components/doc";
import { Popover } from "~/components/ui/floating";

// Collapsible document outline (H1–H3). Lives in the header row and opens a
// floating panel, so it works the same in read and edit mode. Clicking an entry
// asks the editor to scroll to that heading (re-resolved by ordinal, so it
// stays correct as the doc changes under live collab).
export function DocToc({
  headings,
  onJump,
}: {
  headings: TocHeading[];
  onJump: (ordinal: number) => void;
}) {
  if (headings.length === 0) return null;

  return (
    <Popover
      align="right"
      ariaLabel="Table of contents"
      panelClassName="z-[60] max-h-80 w-64 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-brand-2 focus:outline-none"
      trigger={
        <button
          type="button"
          title="Contents"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <List className="h-3.5 w-3.5" /> Contents
        </button>
      }
    >
      {(close) =>
        headings.map((h) => (
          <button
            key={h.ordinal}
            type="button"
            onClick={() => {
              onJump(h.ordinal);
              close();
            }}
            style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
            className="block w-full truncate rounded py-1 pr-2 text-left text-sm text-foreground hover:bg-muted"
          >
            {h.text || "Untitled heading"}
          </button>
        ))
      }
    </Popover>
  );
}
