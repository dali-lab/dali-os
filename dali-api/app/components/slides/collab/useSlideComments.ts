import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeCommentNudges } from "~/components/doc/comments/comment-nudges";
import type { BodySegment } from "~/lib/comment-body";
import type { SlideComment } from "~/lib/slide-comments";

export interface NewSlideComment {
  body: string;
  bodyJson: BodySegment[];
  parentId: string | null;
  anchor: object | null;
}

export interface SlideCommentsApi {
  comments: SlideComment[];
  error: string | null;
  post: (input: NewSlideComment) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

/** Every comment on the deck, kept fresh by the page's comment stream. */
export function useSlideComments(pageId: string, enabled: boolean): SlideCommentsApi {
  const [comments, setComments] = useState<SlideComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/comments?targetType=doc&targetId=${encodeURIComponent(pageId)}`, { credentials: "include" });
      if (!res.ok) {
        if (alive.current) setError(res.status === 403 ? "You don't have access to comments here." : "Comments didn't load.");
        return;
      }
      const data = (await res.json()) as { comments: SlideComment[] };
      if (alive.current) (setError(null), setComments(data.comments));
    } catch {
      return;
    }
  }, [pageId]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    void refetch();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeCommentNudges(pageId, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refetch(), 300);
    });
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [pageId, enabled, refetch]);

  const post = useCallback(
    async (input: NewSlideComment) => {
      const res = await fetch("/api/comments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "doc", targetId: pageId, ...input }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? "That comment didn't post.");
        return false;
      }
      setError(null);
      await refetch();
      return true;
    },
    [pageId, refetch],
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/comments/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        setError("That comment couldn't be deleted.");
        return false;
      }
      await refetch();
      return true;
    },
    [refetch],
  );

  return { comments, error, post, remove };
}
