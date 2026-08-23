// The one comment composer for every doc/file/guide comment surface: an
// avatar, a borderless line that grows with the draft, and the @/send
// affordances on the right. CommentsRail and DocCommentsPanel both use it for
// their top-level composer and their per-thread replies.

import { useEffect, useRef, useState } from "react";
import { ArrowUp, AtSign } from "lucide-react";

import { Avatar } from "~/components/ui/Avatar";
import {
  MentionTextInput,
  type MentionInputHandle,
} from "~/components/MentionTextInput";

type Identity = { name: string; photoUrl: string | null };

// The avatar and the @/send controls are one uniform 32px column each, centred
// against the input so the three read as a single row rather than three
// differently-sized things resting on the text's baseline.
const FLANK = "flex h-8 shrink-0 items-center";

// Resolved once per user id per page load — every composer on the page (rail
// plus one per thread) reads the same entry rather than refetching.
const identityCache = new Map<string, Identity>();
const inflight = new Map<string, Promise<Identity | null>>();

function useIdentity(userId: string): Identity | null {
  const [identity, setIdentity] = useState<Identity | null>(
    () => identityCache.get(userId) ?? null,
  );

  useEffect(() => {
    const cached = identityCache.get(userId);
    if (cached) {
      setIdentity(cached);
      return;
    }
    let cancelled = false;
    let req = inflight.get(userId);
    if (!req) {
      req = fetch(`/api/users/resolve?ids=${encodeURIComponent(userId)}`, {
        credentials: "include",
      })
        .then(async (res) => {
          if (!res.ok) return null;
          const { users } = (await res.json()) as {
            users: { id: string; name: string; photoUrl: string | null }[];
          };
          const me = users.find((u) => u.id === userId);
          if (!me) return null;
          const value = { name: me.name, photoUrl: me.photoUrl };
          identityCache.set(userId, value);
          return value;
        })
        .catch(() => null)
        .finally(() => inflight.delete(userId));
      inflight.set(userId, req);
    }
    void req.then((value) => {
      if (!cancelled && value) setIdentity(value);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return identity;
}

export function CommentComposer({
  currentUserId,
  value,
  onChange,
  onSubmit,
  onCancel,
  busy = false,
  autoFocus = false,
  placeholder = "Add a comment…",
  submitLabel = "Post comment",
  className = "",
}: {
  currentUserId: string;
  value: string;
  onChange: (v: string) => void;
  /** Called with the trimmed draft; the caller clears `value` on success. */
  onSubmit: () => void;
  /** Escape closes the composer when the host has something to close. */
  onCancel?: () => void;
  busy?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  submitLabel?: string;
  className?: string;
}) {
  const me = useIdentity(currentUserId);
  const inputRef = useRef<MentionInputHandle>(null);
  const canPost = !busy && value.trim().length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canPost) onSubmit();
      }}
      className={`flex items-center gap-2.5 border-b border-border py-2 focus-within:border-foreground/30 ${className}`}
    >
      <span className={FLANK}>
        {/* A neutral disc until the identity fetch lands — an unresolved Avatar
            would flash a "?" initial. */}
        {me ? (
          <Avatar photoUrl={me.photoUrl} name={me.name} size="sm" />
        ) : (
          <span className="h-8 w-8 rounded-full bg-muted" aria-hidden />
        )}
      </span>
      <MentionTextInput
        multiline
        autoGrow
        rows={1}
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        wrapperClassName="relative min-w-0 flex-1"
        className="max-h-48 w-full resize-none border-0 bg-transparent px-0 py-1.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
        inputRef={inputRef}
        onKeyDown={(e) => {
          if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
            return;
          }
          // Enter posts, Shift+Enter breaks the line — the mention dropdown
          // has already claimed Enter when it's open.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canPost) onSubmit();
          }
        }}
      />
      <div className={`${FLANK} gap-1`}>
        <button
          type="button"
          onClick={() => inputRef.current?.insertMentionTrigger()}
          aria-label="Mention someone"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        >
          <AtSign className="h-[18px] w-[18px]" aria-hidden />
        </button>
        <button
          type="submit"
          disabled={!canPost}
          aria-label={submitLabel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-colors disabled:bg-muted disabled:text-muted-foreground"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </form>
  );
}
