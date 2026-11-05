import { ArrowRight, Circle, Image as ImageIcon, Minus, Plus, Redo2, Shapes, Square, Type, Undo2 } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { Button } from "~/components/ui/Button";
import { Menu, Popover } from "~/components/ui/floating";
import { SHAPE_LABELS, SHAPE_KINDS, type ShapeKind } from "~/components/slides/deck/model";
import type { ArmedTool } from "./FreeformLayer";
import { LayoutGrid } from "./LayoutPicker";

const SHAPE_ICONS: Record<ShapeKind, React.ReactNode> = {
  rect: <Square className="h-3.5 w-3.5" aria-hidden />,
  rounded: <Square className="h-3.5 w-3.5" aria-hidden />,
  ellipse: <Circle className="h-3.5 w-3.5" aria-hidden />,
  line: <Minus className="h-3.5 w-3.5" aria-hidden />,
  arrow: <ArrowRight className="h-3.5 w-3.5" aria-hidden />,
};

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAdd,
  onImage,
  armed = null,
  onArm,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAdd: (layoutId: string) => void;
  onImage: () => void;
  armed?: ArmedTool | null;
  onArm?: (tool: ArmedTool | null) => void;
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
      {onArm && (
        <>
          <Button variant="ghost" size="sm" aria-pressed={armed?.type === "text"} onClick={() => onArm(armed?.type === "text" ? null : { type: "text" })}>
            <Type className="h-3.5 w-3.5" aria-hidden />
            Text box
          </Button>
          <Menu
            ariaLabel="Shapes"
            trigger={
              <Button variant="ghost" size="sm" aria-pressed={armed?.type === "shape"}>
                <Shapes className="h-3.5 w-3.5" aria-hidden />
                Shape
              </Button>
            }
          >
            {SHAPE_KINDS.map((shape) => (
              <Menu.Item key={shape} icon={SHAPE_ICONS[shape]} onSelect={() => onArm({ type: "shape", shape })}>
                {SHAPE_LABELS[shape]}
              </Menu.Item>
            ))}
          </Menu>
        </>
      )}
      <Button variant="ghost" size="sm" onClick={onImage}>
        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
        Image
      </Button>
    </div>
  );
}
