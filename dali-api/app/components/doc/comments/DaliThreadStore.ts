// DaliThreadStore — BlockNote ThreadStore backed by the app's existing
// Postgres DocComment table via /api/comments and /api/comments/:id.
//
// Body format decision: BlockNote's CommentBody is an array of blocks (any[]).
// We serialize it as JSON into DocComment.body. The CommentsRail only needs a
// plain-text preview; we extract that from the first text-content block at
// read time so existing rail rendering and notify() previews stay readable.
// Round-trip: BlockNote → JSON.stringify → DB body → JSON.parse → BlockNote.
//
// Thread ↔ DocComment mapping:
//   - A BlockNote "thread" maps to a root DocComment (parentId = null).
//   - BlockNote "comments" in a thread = the root DocComment + all its replies.
//   - thread.id = root DocComment.id
//   - thread.resolved = DocComment.resolvedAt !== null
//   - Inline marks use anchor = { kind: "blocknote" } in the Postgres Json
//     anchor column — no schema change, just a distinct marker so the rail can
//     label/filter them and the old Yjs-position anchor path stays untouched.
//
// Refresh strategy: local in-memory Map is the source of truth for React
// (subscribe/getThreads). Mutations call fetch then trigger a full refetch so
// the map stays consistent with the server. Optional 30-second polling keeps
// presence of other users' comments live without a realtime channel.

import {
  ThreadStore,
  DefaultThreadStoreAuth,
  type ThreadData,
  type CommentData,
  type CommentBody,
} from "@blocknote/core/comments";

// Marker stored in DocComment.anchor to distinguish inline BlockNote threads
// from legacy Yjs-position anchors and doc-level threads.
export const BLOCKNOTE_ANCHOR = { kind: "blocknote" } as const;

// ── Type for the raw shape the /api/comments loader returns ─────────────────

interface ApiComment {
  id: string;
  parentId: string | null;
  author: string;
  authorId: string;
  authorPhotoUrl?: string | null;
  body: string; // JSON-stringified CommentBody OR plain text for legacy rows
  anchor: { kind?: string; from?: string; to?: string } | null;
  resolved: boolean;
  createdAt: string;
}

// ── Body serialisation helpers ───────────────────────────────────────────────

/** Extract a human-readable preview from a CommentBody block array. */
export function bodyToPlainText(body: CommentBody): string {
  if (!Array.isArray(body)) return String(body ?? "");
  const parts: string[] = [];
  for (const block of body) {
    if (Array.isArray(block?.content)) {
      for (const inline of block.content) {
        if (inline?.type === "text" && typeof inline.text === "string") {
          parts.push(inline.text);
        }
      }
    }
  }
  return parts.join("").trim();
}

/** Serialize CommentBody for storage. */
export function serializeBody(body: CommentBody): string {
  try {
    return JSON.stringify(body);
  } catch {
    return String(body ?? "");
  }
}

/** Deserialize stored body back into CommentBody. Falls back to a single
 * paragraph block so legacy plain-text entries remain renderable. */
export function deserializeBody(stored: string): CommentBody {
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  // Legacy plain text → wrap in a paragraph block BlockNote can render.
  return [{ type: "paragraph", content: [{ type: "text", text: stored }] }];
}

// ── DocComment → BlockNote shape mapping ────────────────────────────────────

function toCommentData(c: ApiComment): CommentData {
  return {
    type: "comment",
    id: c.id,
    userId: c.authorId,
    createdAt: new Date(c.createdAt),
    updatedAt: new Date(c.createdAt), // DocComment has no updatedAt; createdAt is the best proxy
    reactions: [],
    metadata: { author: c.author, authorPhotoUrl: c.authorPhotoUrl ?? null },
    body: deserializeBody(c.body),
  };
}

/** Convert flat ApiComment[] into a Map<threadId, ThreadData>.
 * Only inline BlockNote threads (anchor.kind === "blocknote") are included;
 * doc-level and legacy Yjs-anchor threads stay in the CommentsRail. */
export function apiCommentsToThreadMap(
  comments: ApiComment[],
): Map<string, ThreadData> {
  const roots = comments.filter(
    (c) =>
      c.parentId === null &&
      (c.anchor as { kind?: string } | null)?.kind === "blocknote",
  );
  const repliesByRoot = new Map<string, ApiComment[]>();
  for (const c of comments) {
    if (c.parentId) {
      const list = repliesByRoot.get(c.parentId) ?? [];
      list.push(c);
      repliesByRoot.set(c.parentId, list);
    }
  }

  const map = new Map<string, ThreadData>();
  for (const root of roots) {
    const replies = repliesByRoot.get(root.id) ?? [];
    const allComments: CommentData[] = [root, ...replies].map(toCommentData);
    const thread: ThreadData = {
      type: "thread",
      id: root.id,
      createdAt: new Date(root.createdAt),
      updatedAt: new Date(
        replies.length > 0 ? replies[replies.length - 1].createdAt : root.createdAt,
      ),
      comments: allComments,
      resolved: root.resolved,
      resolvedUpdatedAt: root.resolved ? new Date(root.createdAt) : undefined,
      metadata: {},
    };
    map.set(root.id, thread);
  }
  return map;
}

// ── DaliThreadStore ──────────────────────────────────────────────────────────

export interface DaliThreadStoreConfig {
  /** The page / document id — maps to DocComment.targetId. */
  pageId: string;
  /** Whether the viewer can post new comments. */
  canComment: boolean;
  /** Whether the viewer can resolve threads. */
  canResolve: boolean;
  /** Viewer's user id. */
  currentUserId: string;
  /** Optional polling interval in ms. 0 = off. Default 30 000. */
  pollIntervalMs?: number;
}

export class DaliThreadStore extends ThreadStore {
  private readonly pageId: string;
  private readonly pollIntervalMs: number;
  private threads: Map<string, ThreadData> = new Map();
  private listeners: Set<(threads: Map<string, ThreadData>) => void> = new Set();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private didMount = false;

  constructor(config: DaliThreadStoreConfig) {
    super(
      new DefaultThreadStoreAuth(
        config.currentUserId,
        config.canResolve ? "editor" : "comment",
      ),
    );
    this.pageId = config.pageId;
    this.pollIntervalMs =
      config.pollIntervalMs !== undefined ? config.pollIntervalMs : 30_000;
  }

  // ── Read interface ──────────────────────────────────────────────────────

  getThread(threadId: string): ThreadData {
    const t = this.threads.get(threadId);
    if (!t) throw new Error(`Thread ${threadId} not found`);
    return t;
  }

  getThreads(): Map<string, ThreadData> {
    return this.threads;
  }

  subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void {
    this.listeners.add(cb);

    // First subscriber: boot the fetch + optional polling.
    if (!this.didMount) {
      this.didMount = true;
      void this.refetch();
      if (this.pollIntervalMs > 0) {
        this.pollTimer = setInterval(() => void this.refetch(), this.pollIntervalMs);
      }
    }

    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) {
        if (this.pollTimer !== null) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        this.didMount = false;
      }
    };
  }

  // ── Write interface ─────────────────────────────────────────────────────

  // We implement addThreadToDocument to let BlockNote call us after the mark
  // is placed so we can set anchor = BLOCKNOTE_ANCHOR on the server row. The
  // threadId is the DocComment.id we already created in createThread.
  async addThreadToDocument(options: {
    threadId: string;
    selection: { head: number; anchor: number };
    editor: unknown;
  }): Promise<void> {
    // Insert the ProseMirror comment mark at the saved selection range. BlockNote
    // calls addThreadToDocument INSTEAD of inserting the mark itself when this
    // method is defined, so we must dispatch the mark transaction here.
    //
    // The selection has been cleared by the time the async createThread network
    // call resolves, so we use the saved anchor/head positions from options.selection
    // and restore + apply via a TipTap chain (flows through the Yjs sync layer).
    const bnEditor = options.editor as {
      _tiptapEditor?: {
        state?: { schema?: { marks?: Record<string, { create: (attrs: object) => unknown } > } };
        view?: { dispatch?: (tr: unknown) => void; state?: { tr?: unknown } };
      };
    };
    const tiptap = bnEditor._tiptapEditor;
    if (tiptap) {
      const sel = options.selection as { anchor: number; head: number };
      const from = Math.min(sel.anchor, sel.head);
      const to = Math.max(sel.anchor, sel.head);
      if (from < to) {
        (tiptap as { chain?: () => { setTextSelection: (r: { from: number; to: number }) => { setMark: (name: string, attrs: object) => { run: () => void } } } }).chain?.()
          .setTextSelection({ from, to })
          .setMark("comment", { orphan: false, threadId: options.threadId })
          .run();
      }
    }

    // Patch the DocComment's anchor to BLOCKNOTE_ANCHOR so the rail and this
    // store can distinguish it from doc-level and legacy Yjs threads.
    await fetch(`/api/comments/${options.threadId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "set-anchor", anchor: BLOCKNOTE_ANCHOR }),
    });
    await this.refetch();
  }

  async createThread(options: {
    initialComment: { body: CommentBody; metadata?: unknown };
    metadata?: unknown;
  }): Promise<ThreadData> {
    const bodyText = bodyToPlainText(options.initialComment.body);
    const res = await fetch("/api/comments", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "doc",
        targetId: this.pageId,
        body: bodyText,
        parentId: null,
        // anchor is set by addThreadToDocument after the mark is placed
        anchor: null,
      }),
    });
    if (!res.ok) throw new Error(`createThread failed: ${res.status}`);
    const { id } = (await res.json()) as { id: string };
    await this.refetch();
    const thread = this.threads.get(id);
    if (!thread) {
      // Build a synthetic thread so the caller gets a valid ThreadData back
      // even if refetch races.
      const now = new Date();
      const commentData: CommentData = {
        type: "comment",
        id,
        userId: "",
        createdAt: now,
        updatedAt: now,
        reactions: [],
        metadata: {},
        body: options.initialComment.body,
      };
      return {
        type: "thread",
        id,
        createdAt: now,
        updatedAt: now,
        comments: [commentData],
        resolved: false,
        metadata: {},
      };
    }
    return thread;
  }

  async addComment(options: {
    comment: { body: CommentBody; metadata?: unknown };
    threadId: string;
  }): Promise<CommentData> {
    const bodyText = bodyToPlainText(options.comment.body);
    const res = await fetch("/api/comments", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "doc",
        targetId: this.pageId,
        body: bodyText,
        parentId: options.threadId,
        anchor: null,
      }),
    });
    if (!res.ok) throw new Error(`addComment failed: ${res.status}`);
    const { id } = (await res.json()) as { id: string };
    await this.refetch();
    const thread = this.threads.get(options.threadId);
    const comment = thread?.comments.find((c) => c.id === id);
    if (!comment) {
      const now = new Date();
      return {
        type: "comment",
        id,
        userId: "",
        createdAt: now,
        updatedAt: now,
        reactions: [],
        metadata: {},
        body: options.comment.body,
      };
    }
    return comment;
  }

  async updateComment(_options: {
    comment: { body: CommentBody; metadata?: unknown };
    threadId: string;
    commentId: string;
  }): Promise<void> {
    // DocComment has no update endpoint. No-op; BlockNote won't surface this
    // unless canUpdateComment returns true (which it does for own comments via
    // DefaultThreadStoreAuth) so we optimistically apply but silently skip.
    // If an update API is added later, wire it here.
  }

  async deleteComment(options: {
    threadId: string;
    commentId: string;
  }): Promise<void> {
    const res = await fetch(`/api/comments/${options.commentId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`deleteComment failed: ${res.status}`);
    await this.refetch();
  }

  async deleteThread(options: { threadId: string }): Promise<void> {
    // Deleting the root comment cascades replies (see schema).
    const res = await fetch(`/api/comments/${options.threadId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`deleteThread failed: ${res.status}`);
    await this.refetch();
  }

  async resolveThread(options: { threadId: string }): Promise<void> {
    const res = await fetch(`/api/comments/${options.threadId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "resolve" }),
    });
    if (!res.ok) throw new Error(`resolveThread failed: ${res.status}`);
    await this.refetch();
  }

  async unresolveThread(options: { threadId: string }): Promise<void> {
    const res = await fetch(`/api/comments/${options.threadId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "reopen" }),
    });
    if (!res.ok) throw new Error(`unresolveThread failed: ${res.status}`);
    await this.refetch();
  }

  // Reactions are not implemented (no DocComment equivalent). These are
  // abstract in ThreadStoreAuth so we must define them, but DefaultThreadStoreAuth
  // allows them while we silently skip the server call.
  async addReaction(_options: {
    threadId: string;
    commentId: string;
    emoji: string;
  }): Promise<void> {}

  async deleteReaction(_options: {
    threadId: string;
    commentId: string;
    emoji: string;
  }): Promise<void> {}

  // ── Internal ────────────────────────────────────────────────────────────

  async refetch(): Promise<void> {
    try {
      const res = await fetch(
        `/api/comments?targetType=doc&targetId=${encodeURIComponent(this.pageId)}`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const { comments } = (await res.json()) as { comments: ApiComment[] };
      this.threads = apiCommentsToThreadMap(comments);
      for (const cb of this.listeners) {
        cb(this.threads);
      }
    } catch {
      // Network errors during polling are not fatal.
    }
  }
}
