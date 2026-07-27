import type { Editor } from "@tiptap/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AlignJustify, Baseline, Check, ChevronDown, Highlighter } from "lucide-react";

// Shared popover-based formatting controls (text color, highlight, line
// spacing). Used by both the fixed editor toolbar and the selection bubble
// toolbar so the two stay in sync — one source of truth for the swatches and
// commands.

// Curated text colors for the picker. Concrete hex (not CSS vars) so the value
// survives copy/paste and HTML export as a plain inline style.
// DALI brand hues at text-legible shades. The raw brand accents (soft coral,
// pale yellow/green) fail contrast as body text, so these are deeper, saturated
// versions tuned to read on BOTH the light and dark theme. Concrete hex (not CSS
// vars) so the value survives copy/paste and HTML export as a plain inline style.
const TEXT_COLORS: { label: string; value: string }[] = [
  { label: "Coral", value: "#D6473E" },
  { label: "Teal", value: "#0E9C93" },
  { label: "Amber", value: "#B7791F" },
  { label: "Green", value: "#4E9A3F" },
  { label: "Blue", value: "#2A6F97" },
  { label: "Purple", value: "#7C5CD6" },
  { label: "Pink", value: "#C64F93" },
  { label: "Gray", value: "#64748B" },
];

// Highlight (text background) swatches. Soft tints so dark body text stays
// readable on top; concrete hex so the value survives copy/paste + HTML export.
const HIGHLIGHT_COLORS: { label: string; value: string }[] = [
  { label: "Yellow", value: "#FEF3C7" },
  { label: "Green", value: "#D1FAE5" },
  { label: "Blue", value: "#DBEAFE" },
  { label: "Purple", value: "#EDE9FE" },
  { label: "Pink", value: "#FCE7F3" },
  { label: "Orange", value: "#FFEDD5" },
  { label: "Red", value: "#FEE2E2" },
  { label: "Gray", value: "#E5E7EB" },
];

const LINE_SPACINGS: { label: string; value: string | null }[] = [
  { label: "Default", value: null },
  { label: "Single", value: "1" },
  { label: "1.5", value: "1.5" },
  { label: "Double", value: "2" },
];

// Small toolbar dropdown: a trigger that toggles a popover panel, closing on
// outside click. Shared by the color + line-spacing controls.
export function ToolbarPopover({
  title,
  trigger,
  children,
}: {
  title: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className={`inline-flex items-center gap-0.5 rounded p-1.5 transition-colors ${
          open
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        {trigger}
        <ChevronDown size={11} aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 rounded-md border border-border bg-card p-2 shadow-brand-2">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function ColorControl({ editor }: { editor: Editor }) {
  const current = (editor.getAttributes("textStyle").color as string | undefined) ?? null;
  return (
    <ToolbarPopover
      title="Text color"
      trigger={<Baseline size={15} style={current ? { color: current } : undefined} />}
    >
      {(close) => (
        <div className="w-max">
          <div className="grid grid-cols-4 gap-1">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={c.label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().setColor(c.value).run();
                  close();
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-black/10"
                style={{ backgroundColor: c.value }}
              >
                {current === c.value && <Check size={12} className="text-white" />}
              </button>
            ))}
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-muted-foreground hover:text-foreground">
            <span
              className="relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-black/10"
              style={{
                background:
                  "conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)",
              }}
            >
              {/* Native picker for any hue. Can't preventDefault (that would
                  block the OS dialog); the editor blurs to the dialog, but
                  chain().focus() restores the stored selection before setColor. */}
              <input
                type="color"
                value={current ?? "#000000"}
                onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
                aria-label="Custom text color"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </span>
            Custom…
          </label>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().unsetColor().run();
              close();
            }}
            className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Default color
          </button>
        </div>
      )}
    </ToolbarPopover>
  );
}

export function HighlightControl({ editor }: { editor: Editor }) {
  const current = (editor.getAttributes("highlight").color as string | undefined) ?? null;
  return (
    <ToolbarPopover
      title="Highlight"
      trigger={<Highlighter size={15} style={current ? { color: current } : undefined} />}
    >
      {(close) => (
        <div className="w-max">
          <div className="grid grid-cols-4 gap-1">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={c.label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().setHighlight({ color: c.value }).run();
                  close();
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-black/10"
                style={{ backgroundColor: c.value }}
              >
                {current === c.value && <Check size={12} className="text-black/70" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().unsetHighlight().run();
              close();
            }}
            className="mt-2 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            No highlight
          </button>
        </div>
      )}
    </ToolbarPopover>
  );
}

export function LineSpacingControl({ editor }: { editor: Editor }) {
  const current =
    (editor.getAttributes("paragraph").lineHeight as string | undefined) ??
    (editor.getAttributes("heading").lineHeight as string | undefined) ??
    null;
  return (
    <ToolbarPopover title="Line spacing" trigger={<AlignJustify size={15} />}>
      {(close) => (
        <div className="min-w-[7rem]">
          {LINE_SPACINGS.map((s) => {
            const active = (s.value ?? null) === current;
            return (
              <button
                key={s.label}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (s.value) editor.chain().focus().setLineHeight(s.value).run();
                  else editor.chain().focus().unsetLineHeight().run();
                  close();
                }}
                className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-sm transition-colors ${
                  active ? "text-accent-coral" : "text-foreground hover:bg-muted"
                }`}
              >
                {s.label}
                {active && <Check size={13} aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </ToolbarPopover>
  );
}
