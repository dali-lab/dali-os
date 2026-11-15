import type { ImageAnchor } from "~/lib/slide-comments";

export function critThreadHref(pageId: string, target: { submissionId: string; threadId?: string | null }): string {
  const params = new URLSearchParams({ post: target.submissionId });
  if (target.threadId) params.set("thread", target.threadId);
  return `/resource-hub/${pageId}/crit?${params.toString()}`;
}

export function parseCritLink(search: URLSearchParams): { submissionId: string | null; threadId: string | null } {
  return { submissionId: search.get("post") || null, threadId: search.get("thread") || null };
}

export function imageAnchorOf(anchor: unknown): ImageAnchor | null {
  const a = anchor as Partial<ImageAnchor> | null;
  return a && a.kind === "image" && typeof a.x === "number" && typeof a.y === "number" ? { kind: "image", x: a.x, y: a.y } : null;
}
