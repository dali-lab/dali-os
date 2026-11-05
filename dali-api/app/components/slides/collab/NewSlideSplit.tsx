import { ChevronDown, Plus } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Popover } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { LayoutGrid } from "./LayoutPicker";

/** Click to add a slide with the current layout. The arrow opens the layout gallery. */
export function NewSlideSplit({
  themeId,
  layoutId,
  onAdd,
  variant = "ghost",
  className,
}: {
  themeId: string;
  layoutId: string | null;
  onAdd: (layoutId: string) => void;
  variant?: "ghost" | "secondary";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center", className)}>
      <Button variant={variant} size="sm" className="min-w-0 flex-1" onClick={() => onAdd(layoutId ?? "content")}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        New slide
      </Button>
      <Popover trigger={<IconButton label="Choose a layout" icon={ChevronDown} />} ariaLabel="Choose a layout">
        {(close) => (
          <div className="w-72 p-2">
            <LayoutGrid
              themeId={themeId}
              columns={2}
              onPick={(id) => {
                onAdd(id);
                close();
              }}
            />
          </div>
        )}
      </Popover>
    </div>
  );
}
