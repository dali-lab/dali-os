import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Popover } from "~/components/ui/floating";
import { Segmented } from "~/components/ui/Segmented";
import { TemplateLibrary } from "~/components/slides/templates/TemplateLibrary";
import type { TemplateRow } from "~/components/slides/templates/templates-client";
import { cn } from "~/lib/cn";
import { LayoutGrid } from "./LayoutPicker";

export interface SlideLibrary {
  templates: TemplateRow[];
  loaded: boolean;
  onPick: (row: TemplateRow) => void;
  onDelete: (row: TemplateRow) => void;
}

function Gallery({ themeId, onPick, library }: { themeId: string; onPick: (layoutId: string) => void; library?: SlideLibrary }) {
  const [tab, setTab] = useState<"layouts" | "library">("layouts");
  return (
    <div className="flex w-72 flex-col gap-2 p-2">
      {library && (
        <Segmented
          ariaLabel="New slide from"
          fullWidth
          value={tab}
          onChange={setTab}
          options={[
            { value: "layouts", label: "Layouts" },
            { value: "library", label: "Library" },
          ]}
        />
      )}
      {tab === "library" && library ? (
        <TemplateLibrary templates={library.templates} loaded={library.loaded} onPick={library.onPick} onDelete={library.onDelete} />
      ) : (
        <LayoutGrid themeId={themeId} columns={2} onPick={onPick} />
      )}
    </div>
  );
}

/** Click to add a slide with the current layout. The arrow opens the layout gallery. */
export function NewSlideSplit({
  themeId,
  layoutId,
  onAdd,
  variant = "ghost",
  className,
  library,
}: {
  themeId: string;
  layoutId: string | null;
  onAdd: (layoutId: string) => void;
  variant?: "ghost" | "secondary";
  className?: string;
  library?: SlideLibrary;
}) {
  return (
    <div className={cn("flex items-center", className)}>
      <Button variant={variant} size="sm" className="min-w-0 flex-1" onClick={() => onAdd(layoutId ?? "content")}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        New slide
      </Button>
      <Popover trigger={<IconButton label="Choose a layout" icon={ChevronDown} />} ariaLabel="Choose a layout">
        {(close) => (
          <Gallery
            themeId={themeId}
            onPick={(id) => {
              onAdd(id);
              close();
            }}
            library={library && { ...library, onPick: (row) => (library.onPick(row), close()) }}
          />
        )}
      </Popover>
    </div>
  );
}
