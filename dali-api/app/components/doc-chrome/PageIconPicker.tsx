import { useEffect, useRef, useState } from "react";

// Notion-style page icon. Surfaces Page.iconEmoji (persisted by the host via
// onChange). No emoji-picker dependency in the repo, so this is a small curated
// grid plus a native input that accepts any pasted/typed emoji.
const CURATED = [
  "📄", "📝", "📌", "📎", "🗂️", "📁", "📚", "📖",
  "✅", "📋", "🎯", "🚀", "💡", "🔧", "⚙️", "🧪",
  "📊", "📈", "🧭", "🗺️", "🎨", "🖌️", "🧠", "💬",
  "🔬", "🧩", "🏗️", "🌱", "🔥", "⭐", "❤️", "⚡",
  "📅", "⏰", "🔔", "🏷️", "🔗", "📦", "🧰", "🗒️",
];

export function PageIconPicker({
  iconEmoji,
  canEdit,
  onChange,
  // Legacy compat: editing was the old prop name — if canEdit is absent but
  // editing is present, treat them the same. Callers should migrate to canEdit.
  editing,
}: {
  iconEmoji: string | null;
  canEdit?: boolean;
  onChange: (emoji: string | null) => void;
  /** @deprecated use canEdit */
  editing?: boolean;
}) {
  const editable = canEdit ?? editing ?? false;
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

  // Read-only: show the icon if set, otherwise render nothing so the title
  // sits flush.
  if (!editable) {
    return iconEmoji ? (
      <span className="text-4xl leading-none" aria-hidden>
        {iconEmoji}
      </span>
    ) : null;
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title={iconEmoji ? "Change icon" : "Add icon"}
        className={
          iconEmoji
            ? "text-4xl leading-none hover:opacity-80"
            : "text-xs text-muted-foreground hover:text-foreground rounded border border-dashed border-border px-2 py-1"
        }
      >
        {iconEmoji ?? "Add icon"}
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-max rounded-md border border-border bg-card p-2 shadow-brand-2">
          <div className="grid grid-cols-8 gap-1">
            {CURATED.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
                className="flex h-7 w-7 items-center justify-center rounded text-lg hover:bg-muted"
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              defaultValue={iconEmoji ?? ""}
              maxLength={8}
              placeholder="Paste emoji"
              aria-label="Custom emoji"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = (e.target as HTMLInputElement).value.trim();
                onChange(v || null);
                setOpen(false);
              }}
              className="w-24 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent-coral/40"
            />
            {iconEmoji && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
