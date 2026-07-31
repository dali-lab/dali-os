import { useRef, useState, type KeyboardEvent, type ChangeEvent } from "react";

export type MentionUser = {
  id: string;
  name: string;
  handle: string;
  photoUrl?: string | null;
};

async function searchMentionableUsers(q: string): Promise<MentionUser[]> {
  try {
    const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(q)}`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { members?: MentionUser[] };
    return data.members ?? [];
  } catch {
    return [];
  }
}

// A plain <textarea>/<input> with an @-mention autocomplete dropdown, for
// composers that aren't rich-text editors (comment + reply boxes). The stored
// value is plain text with "@handle" tokens — the server parses those
// (extractHandlesFromText) to notify, so no rich node model is needed here.

// Find an active "@query" token ending at the caret. Only fires when the "@" is
// at the start or preceded by whitespace, so emails ("a@b") don't trigger it.
function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([a-zA-Z0-9_]*)$/.exec(before);
  if (!m) return null;
  const query = m[2] ?? "";
  return { start: caret - query.length - 1, query };
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
  rows?: number;
  /** Applied to the input/textarea. */
  className?: string;
  /** Applied to the positioning wrapper (e.g. "flex-1" in a flex row). */
  wrapperClassName?: string;
  /** Forwarded for keys the mention dropdown doesn't consume (e.g. an
   *  Enter-to-submit handler). Not called while the dropdown handles the key. */
  onKeyDown?: (e: KeyboardEvent) => void;
};

export function MentionTextInput({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  multiline = false,
  rows,
  className,
  wrapperClassName = "relative",
  onKeyDown,
}: Props) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MentionUser[]>([]);
  const [sel, setSel] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const reqId = useRef(0);

  function refreshMention(el: HTMLTextAreaElement | HTMLInputElement) {
    const caret = el.selectionStart ?? el.value.length;
    const m = activeMention(el.value, caret);
    if (!m) {
      setOpen(false);
      setMentionStart(null);
      setItems([]);
      return;
    }
    setMentionStart(m.start);
    setOpen(true);
    const id = ++reqId.current;
    void searchMentionableUsers(m.query).then((r) => {
      if (id === reqId.current) {
        setItems(r);
        setSel(0);
      }
    });
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) {
    onChange(e.target.value);
    refreshMention(e.target);
  }

  function insert(user: MentionUser) {
    const el = ref.current;
    if (!el || mentionStart == null) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(caret);
    const inserted = `@${user.handle} `;
    onChange(before + inserted + after);
    setOpen(false);
    setMentionStart(null);
    setItems([]);
    const pos = before.length + inserted.length;
    // Restore the caret after the inserted handle on the next frame (after the
    // controlled value re-renders).
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  // When the dropdown is open we own Arrow/Enter/Tab/Escape; otherwise the key
  // falls through so the surrounding form submits (input) or newlines (textarea)
  // exactly as before.
  function handleKeyDown(e: KeyboardEvent) {
    if (open && items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => (s + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => (s - 1 + items.length) % items.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insert(items[sel]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
    onKeyDown?.(e);
  }

  const shared = {
    ref,
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    // Keep the mention token in sync when the caret moves without a value change.
    onKeyUp: (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        refreshMention(e.currentTarget as HTMLTextAreaElement | HTMLInputElement);
      }
    },
    onBlur: () => setTimeout(() => setOpen(false), 120),
    placeholder,
    disabled,
    autoFocus,
    className,
  };

  return (
    <div className={wrapperClassName}>
      {multiline ? <textarea rows={rows} {...shared} /> : <input {...shared} />}
      {open && items.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-card py-1 text-sm shadow-brand-2">
          {items.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insert(u);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                i === sel ? "bg-muted" : "hover:bg-muted/60"
              }`}
            >
              <span className="font-medium text-foreground">{u.name}</span>
              <span className="text-xs text-muted-foreground">@{u.handle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
