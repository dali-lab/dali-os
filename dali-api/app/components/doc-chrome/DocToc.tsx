import { List } from "lucide-react";
import type { TocHeading } from "~/components/doc";
import { Popover } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

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
  // Same dress as every other control in the document's action row (Aa, Share,
  // comments, star, ⋯) — it used to be a small bordered box among pills.
  const { actionBtn, actionIcon, popover } = useOsChrome();

  if (headings.length === 0) return null;

  return (
    <Popover
      align="right"
      ariaLabel="Table of contents"
      panelClassName={cn(
        "z-[60] max-h-80 w-64 overflow-y-auto p-1 focus:outline-none",
        popover,
      )}
      trigger={
        <button type="button" className={actionBtn()}>
          <List className={actionIcon} /> Contents
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
