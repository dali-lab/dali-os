import { LayoutGrid as GridIcon, Minimize2, PanelRight, Redo2, Undo2 } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import type { ArmedTool } from "./FreeformLayer";
import { InsertMenu, type InsertItem } from "./InsertMenu";
import { NewSlideSplit, type SlideLibrary } from "./NewSlideSplit";
import { shortcutHint } from "./shortcuts";

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
  inspectorHidden = false,
  onToggleInspector,
  focus = false,
  onExitFocus,
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
  inspectorHidden?: boolean;
  onToggleInspector?: () => void;
  focus?: boolean;
  onExitFocus?: () => void;
}) {
  return (
    <div role="toolbar" aria-label="Slide tools" className="flex shrink-0 items-center gap-1 border-b border-os-container px-3 py-1.5">
      <IconButton label="Undo" icon={Undo2} disabled={!canUndo} onClick={onUndo} />
      <IconButton label="Redo" icon={Redo2} disabled={!canRedo} onClick={onRedo} />
      {!focus && <span aria-hidden className="mx-1 h-5 w-px bg-os-container" />}
      {!focus && <NewSlideSplit themeId={themeId} layoutId={currentLayoutId} onAdd={onAdd} library={library} />}
      {focus && <span aria-hidden className="mx-1 h-5 w-px bg-os-container" />}
      {onInsert && <InsertMenu armed={armed !== null} onInsert={onInsert} />}
      {focus && onExitFocus && (
        <Button variant="ghost" size="sm" onClick={onExitFocus} className="ml-auto">
          <Minimize2 className="h-3.5 w-3.5" aria-hidden />
          Exit focus
        </Button>
      )}
      {!focus && onGrid && (
        <Button variant="ghost" size="sm" aria-pressed={grid} onClick={onGrid} className="ml-auto">
          <GridIcon className="h-3.5 w-3.5" aria-hidden />
          Grid
        </Button>
      )}
      {!focus && onToggleInspector && (
        <IconButton
          label={inspectorHidden ? "Show panel" : "Hide panel"}
          shortcut={shortcutHint("inspector")}
          icon={PanelRight}
          aria-pressed={!inspectorHidden}
          onClick={onToggleInspector}
          className={onGrid ? undefined : "ml-auto"}
        />
      )}
    </div>
  );
}
