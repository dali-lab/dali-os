import { useEffect, useRef, useState } from "react";

// Hover card for an @handle chip. A handle alone often doesn't identify anyone
// — this puts the face and full name behind it without leaving the document.
//
// Fetched on first hover rather than embedded in the mention node: the stored
// node is {id, label} by design (see mention.tsx), and a name snapshotted into
// the document would go stale the moment someone changed theirs.

type CardMember = { id: string; name: string; handle: string | null; photoUrl: string | null };

// Module-level cache: a document can repeat the same mention many times, and
// re-fetching per hover would be needless traffic for data that rarely moves.
const cache = new Map<string, CardMember | null>();
const inflight = new Map<string, Promise<CardMember | null>>();

async function loadMember(id: string): Promise<CardMember | null> {
  if (cache.has(id)) return cache.get(id)!;
  const existing = inflight.get(id);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(`/api/mentions/card?id=${encodeURIComponent(id)}`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { member?: CardMember };
      return data.member ?? null;
    } catch {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  const member = await p;
  cache.set(id, member);
  return member;
}

/** Small delay so passing the cursor over a chip on the way elsewhere doesn't
 *  flash a card. */
const OPEN_DELAY_MS = 250;

export function MentionHoverCard({
  userId,
  children,
  className,
  ...rest
}: {
  userId: string;
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState<CardMember | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function show() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setOpen(true);
      if (!member && userId) void loadMember(userId).then(setMember);
    }, OPEN_DELAY_MS);
  }

  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }

  return (
    <span
      className={`relative inline-block ${className ?? ""}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      {...rest}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          // contentEditable={false} keeps the card out of the document's own
          // content — without it the editor treats this markup as text and the
          // caret can land inside the popup.
          contentEditable={false}
          className="absolute left-0 top-full z-40 mt-1 flex w-max max-w-[260px] items-center gap-2.5 rounded-lg border border-border bg-card p-2.5 shadow-brand-2"
        >
          {member?.photoUrl ? (
            <img
              src={member.photoUrl}
              alt=""
              className="h-9 w-9 flex-shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent-coral/15 text-xs font-semibold text-accent-coral">
              {initials(member?.name)}
            </span>
          )}
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium text-foreground">
              {member?.name ?? "Loading…"}
            </span>
            {member?.handle && (
              <span className="truncate text-xs text-accent-coral">@{member.handle}</span>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

function initials(name?: string): string {
  if (!name) return "·";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}
