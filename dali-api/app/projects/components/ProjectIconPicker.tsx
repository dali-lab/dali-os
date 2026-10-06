import { useEffect, useRef, useState } from "react";
import {
  ProjectIcon,
  LUCIDE_ICON_LIBRARY,
  LUCIDE_PREFIX,
  isLucideIcon,
} from "~/components/ProjectIcon";

// Project icon picker. The stored value lives in the string `iconEmoji`
// column so both formats coexist without a migration:
//   • `lucide:Name` — svg glyph from the curated lucide set below.
//   • any other string — emoji (back-compat with existing data).
const EMOJI_CURATED = [
  "🚀", "🎯", "💡", "🧭", "🗺️", "🎨", "🖌️", "🧠",
  "📱", "💻", "🕹️", "🔬", "🧪", "🧩", "🏗️", "🌱",
  "🔥", "⭐", "❤️", "⚡", "📊", "📈", "🤖", "🛰️",
  "🌍", "🎓", "🏆", "🔧", "⚙️", "📦", "🧰", "🔗",
];

const LUCIDE_CHOICES = Object.keys(LUCIDE_ICON_LIBRARY);

type Mode = "svg" | "emoji";

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
  const [mode, setMode] = useState<Mode>(isLucideIcon(iconEmoji) || !iconEmoji ? "svg" : "emoji");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!editing) return <ProjectIcon iconEmoji={iconEmoji} size="lg" />;

  const triggerLabel = iconEmoji ? "Change icon" : "Add icon";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title={triggerLabel}
        className={
          iconEmoji
            ? "inline-flex items-center justify-center leading-none hover:opacity-80"
            : "text-xs text-muted-foreground hover:text-foreground rounded border border-dashed border-border px-2 py-1"
        }
      >
        {iconEmoji ? <ProjectIcon iconEmoji={iconEmoji} size="lg" /> : "Add icon"}
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-max rounded-md border border-border bg-card p-2 shadow-brand-2">
          <div className="mb-2 flex items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setMode("svg")}
              aria-pressed={mode === "svg"}
              className={
                "rounded px-2 py-1 font-semibold " +
                (mode === "svg"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              Icons
            </button>
            <button
              type="button"
              onClick={() => setMode("emoji")}
              aria-pressed={mode === "emoji"}
              className={
                "rounded px-2 py-1 font-semibold " +
                (mode === "emoji"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              Emoji
            </button>
          </div>
          {mode === "svg" ? (
            <div className="grid grid-cols-8 gap-1 max-h-56 overflow-y-auto">
              {LUCIDE_CHOICES.map((name) => {
                const value = `${LUCIDE_PREFIX}${name}`;
                const selected = iconEmoji === value;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      onChange(value);
                      setOpen(false);
                    }}
                    title={name}
                    aria-label={name}
                    className={
                      "flex h-8 w-8 items-center justify-center rounded " +
                      (selected
                        ? "bg-accent-coral/20 text-foreground"
                        : "text-foreground hover:bg-muted")
                    }
                  >
                    <ProjectIcon iconEmoji={value} size="sm" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_CURATED.map((emoji) => (
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
          )}
          <div className="mt-2 flex items-center gap-2">
            {mode === "emoji" && (
              <input
                type="text"
                defaultValue={isLucideIcon(iconEmoji) ? "" : (iconEmoji ?? "")}
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
            )}
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
