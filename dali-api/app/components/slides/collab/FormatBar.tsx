import { Bold, Check, Crop, Ellipsis, Image as ImageIcon, Italic, Layers, Link, List, LockOpen, Underline } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Menu } from "~/components/ui/floating";
import { FILL_IDS, FILL_LABELS, type FillId } from "~/components/slides/deck/model";
import type { RenderElement } from "~/components/slides/deck/snapshot";
import { TEXT_STYLE_IDS, TEXT_STYLE_LABELS, themeById, type TextStyleId } from "~/components/slides/deck/themes";
import { cn } from "~/lib/cn";
import { ActionMenuItems } from "./ActionMenuItems";
import { findAction, type ActionSpec } from "./actions";
import type { TextFormat } from "./text-format";

export interface FormatBarHandlers {
  textStyle: (id: string, style: TextStyleId) => void;
  format: (id: string, format: TextFormat) => void;
  fill: (fill: FillId) => void;
  replaceImage: (id: string) => void;
  crop: (id: string) => void;
  resetCrop: (id: string) => void;
  doneCrop: () => void;
  unlock: () => void;
}

const FORMATS: Array<{ format: TextFormat; label: string; icon: typeof Bold }> = [
  { format: "bold", label: "Bold", icon: Bold },
  { format: "italic", label: "Italic", icon: Italic },
  { format: "underline", label: "Underline", icon: Underline },
  { format: "link", label: "Link", icon: Link },
  { format: "bullet", label: "Bulleted list", icon: List },
];

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-os-container" />;
}

/**
 * The bar above the selected element. What it offers depends on the element; arrange and more always come last,
 * and both are cut from the same action list the right-click menu uses.
 */
export function FormatBar({
  element,
  actions,
  themeId,
  cropping,
  handlers,
}: {
  element: RenderElement | null;
  actions: ActionSpec[];
  themeId: string;
  cropping: boolean;
  handlers: FormatBarHandlers;
}) {
  const arrange = findAction(actions, "arrange");
  const theme = themeById(themeId);
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div
      role="toolbar"
      aria-label="Format"
      data-format-bar
      onMouseDown={keep}
      className="flex items-center gap-0.5 whitespace-nowrap rounded-os-card border border-os-container bg-os-card p-1 shadow-[0_8px_24px_var(--color-os-shadow)]"
    >
      {element?.locked ? (
        <Button variant="ghost" size="xs" onClick={handlers.unlock}>
          <LockOpen className="h-3.5 w-3.5" aria-hidden />
          Unlock
        </Button>
      ) : cropping && element ? (
        <>
          <Button variant="ghost" size="xs" onClick={() => handlers.resetCrop(element.id)}>
            Reset crop
          </Button>
          <Button variant="ghost" size="xs" onClick={handlers.doneCrop}>
            <Check className="h-3.5 w-3.5" aria-hidden />
            Done
          </Button>
        </>
      ) : (
        <>
          {element?.kind === "text" && (
            <>
              <Menu
                ariaLabel="Text style"
                trigger={
                  <Button variant="ghost" size="xs">
                    {TEXT_STYLE_LABELS[element.textStyle ?? "body"]}
                  </Button>
                }
              >
                {TEXT_STYLE_IDS.map((id) => (
                  <Menu.Item key={id} checked={(element.textStyle ?? "body") === id} onSelect={() => handlers.textStyle(element.id, id)}>
                    {TEXT_STYLE_LABELS[id]}
                  </Menu.Item>
                ))}
              </Menu>
              <Divider />
              {FORMATS.map((f) => (
                <IconButton key={f.format} label={f.label} icon={f.icon} onClick={() => handlers.format(element.id, f.format)} />
              ))}
            </>
          )}
          {(element?.kind === "shape" || element?.kind === "icon") && (
            <div role="group" aria-label="Fill" className="flex items-center gap-1 px-1">
              {FILL_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-label={FILL_LABELS[id]}
                  aria-pressed={(element.fill ?? "accent") === id}
                  onClick={() => handlers.fill(id)}
                  className={cn("h-5 w-5 rounded-full border-2 transition-colors", (element.fill ?? "accent") === id ? "border-os-accent" : "border-os-container hover:border-os-grey")}
                  style={{ background: theme.colors[id] }}
                />
              ))}
            </div>
          )}
          {element?.kind === "image" && (
            <>
              <IconButton label="Replace image" icon={ImageIcon} onClick={() => handlers.replaceImage(element.id)} />
              <IconButton label="Crop" icon={Crop} onClick={() => handlers.crop(element.id)} />
            </>
          )}
          {element && element.kind !== "group" && <Divider />}
          {arrange?.children && (
            <Menu ariaLabel="Arrange" trigger={<IconButton label="Arrange" icon={Layers} />}>
              <ActionMenuItems actions={arrange.children} />
            </Menu>
          )}
        </>
      )}
      <Menu ariaLabel="More" trigger={<IconButton label="More" icon={Ellipsis} />}>
        <ActionMenuItems actions={actions} />
      </Menu>
    </div>
  );
}
