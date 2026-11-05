import { Plus, Redo2, Undo2 } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { Button } from "~/components/ui/Button";
import { Popover } from "~/components/ui/floating";
import type { ArmedTool } from "./FreeformLayer";
import { InsertMenu, type InsertItem } from "./InsertMenu";
import { LayoutGrid } from "./LayoutPicker";

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAdd,
  onInsert,
  armed = null,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAdd: (layoutId: string) => void;
  onInsert?: (item: InsertItem) => void;
  armed?: ArmedTool | null;
}) {
  return (
    <div role="toolbar" aria-label="Slide tools" className="flex shrink-0 items-center gap-1 border-b border-os-container px-3 py-1.5">
      <IconButton label="Undo" icon={Undo2} disabled={!canUndo} onClick={onUndo} />
      <IconButton label="Redo" icon={Redo2} disabled={!canRedo} onClick={onRedo} />
      <span aria-hidden className="mx-1 h-5 w-px bg-os-container" />
      <Popover
        trigger={
          <Button variant="ghost" size="sm">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New slide
          </Button>
        }
        ariaLabel="Choose a layout"
      >
        {(close) => (
          <div className="w-56 p-2">
            <LayoutGrid
              onPick={(id) => {
                onAdd(id);
                close();
              }}
            />
          </div>
        )}
      </Popover>
      {onInsert && <InsertMenu armed={armed !== null} onInsert={onInsert} />}
    </div>
  );
}
