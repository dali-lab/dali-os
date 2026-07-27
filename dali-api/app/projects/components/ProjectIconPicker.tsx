import { useEffect, useRef, useState } from "react";
import { ProjectIcon } from "~/components/ProjectIcon";

// Notion-style project icon picker. Mirrors the document PageIconPicker: a small
// curated emoji grid plus a native input that accepts any pasted/typed emoji
// (no emoji-picker dependency in the repo). Persisted by the host via onChange.
const CURATED = [
  "🚀", "🎯", "💡", "🧭", "🗺️", "🎨", "🖌️", "🧠",
  "📱", "💻", "🕹️", "🔬", "🧪", "🧩", "🏗️", "🌱",
  "🔥", "⭐", "❤️", "⚡", "📊", "📈", "🤖", "🛰️",
  "🌍", "🎓", "🏆", "🔧", "⚙️", "📦", "🧰", "🔗",
];

export function ProjectIconPicker({
  iconEmoji,
  editing,
  onChange,
}: {
  iconEmoji: string | null;
  editing: boolean;
  onChange: (emoji: string | null) => void;
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

  // Read-only view: show the icon (with its neutral fallback glyph).
  if (!editing) return <ProjectIcon iconEmoji={iconEmoji} size="lg" />;

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
            ? "text-2xl leading-none hover:opacity-80"
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
