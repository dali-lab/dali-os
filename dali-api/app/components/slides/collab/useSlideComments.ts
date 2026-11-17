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
  loaded: boolean;
  error: string | null;
  post: (input: NewSlideComment) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  edit: (id: string, body: string, bodyJson: BodySegment[]) => Promise<boolean>;
  react: (id: string, emoji: string, on: boolean) => Promise<boolean>;
}

export type CommentTargetType = "doc" | "crit";

/** Every comment on a target (a deck by default), kept fresh by the page's comment stream. */
export function useSlideComments(pageId: string, enabled: boolean, targetType: CommentTargetType = "doc"): SlideCommentsApi {
  const [comments, setComments] = useState<SlideComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/comments?targetType=${targetType}&targetId=${encodeURIComponent(pageId)}`, { credentials: "include" });
      if (!res.ok) {
        if (alive.current) setError(res.status === 403 ? "You don't have access to comments here." : "Comments didn't load.");
        return;
      }
      const data = (await res.json()) as { comments: SlideComment[] };
      if (alive.current) (setError(null), setComments(data.comments), setLoaded(true));
    } catch {
      return;
    }
  }, [pageId, targetType]);

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
        body: JSON.stringify({ targetType, targetId: pageId, ...input }),
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
    [pageId, targetType, refetch],
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

  const patch = useCallback(
    async (id: string, payload: object, failure: string) => {
      const res = await fetch(`/api/comments/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(failure);
        return false;
      }
      setError(null);
      await refetch();
      return true;
    },
    [refetch],
  );
  const edit = useCallback(
    (id: string, body: string, bodyJson: BodySegment[]) => patch(id, { intent: "edit", body, bodyJson }, "That edit didn't save."),
    [patch],
  );
  const react = useCallback(
    (id: string, emoji: string, on: boolean) => patch(id, { intent: on ? "react" : "unreact", emoji }, "That reaction didn't save."),
    [patch],
  );

  return { comments, loaded, error, post, remove, edit, react };
}
