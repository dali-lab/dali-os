import { Popover } from "~/components/ui/floating";

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
    <Popover
      ariaLabel="Page icon"
      panelClassName="z-[60] w-max rounded-md border border-border bg-card p-2 shadow-brand-2 focus:outline-none"
      trigger={
        <button
          type="button"
          title={iconEmoji ? "Change icon" : "Add icon"}
          className={
            iconEmoji
              ? "text-4xl leading-none hover:opacity-80"
              : "text-xs text-muted-foreground hover:text-foreground rounded border border-dashed border-border px-2 py-1"
          }
        >
          {iconEmoji ?? "Add icon"}
        </button>
      }
    >
      {(close) => (
        <>
          <div className="grid grid-cols-8 gap-1">
            {CURATED.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onChange(emoji);
                  close();
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
                close();
              }}
              className="w-24 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent-coral/40"
            />
            {iconEmoji && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  close();
                }}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Remove
              </button>
            )}
          </div>
        </>
      )}
    </Popover>
  );
}
