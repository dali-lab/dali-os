import { LayoutGrid as GridIcon, Redo2, Undo2 } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import type { ArmedTool } from "./FreeformLayer";
import { InsertMenu, type InsertItem } from "./InsertMenu";
import { NewSlideSplit, type SlideLibrary } from "./NewSlideSplit";

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAdd,
  onInsert,
  library,
  armed = null,
  themeId = "dali-dark",
  currentLayoutId = null,
  grid = false,
  onGrid,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAdd: (layoutId: string) => void;
  onInsert?: (item: InsertItem) => void;
  library?: SlideLibrary;
  armed?: ArmedTool | null;
  themeId?: string;
  currentLayoutId?: string | null;
  grid?: boolean;
  onGrid?: () => void;
}) {
  return (
    <div role="toolbar" aria-label="Slide tools" className="flex shrink-0 items-center gap-1 border-b border-os-container px-3 py-1.5">
      <IconButton label="Undo" icon={Undo2} disabled={!canUndo} onClick={onUndo} />
      <IconButton label="Redo" icon={Redo2} disabled={!canRedo} onClick={onRedo} />
      <span aria-hidden className="mx-1 h-5 w-px bg-os-container" />
      <NewSlideSplit themeId={themeId} layoutId={currentLayoutId} onAdd={onAdd} library={library} />
      {onInsert && <InsertMenu armed={armed !== null} onInsert={onInsert} />}
      {onGrid && (
        <Button variant="ghost" size="sm" aria-pressed={grid} onClick={onGrid} className="ml-auto">
          <GridIcon className="h-3.5 w-3.5" aria-hidden />
          Grid
        </Button>
      )}
    </div>
  );
}
