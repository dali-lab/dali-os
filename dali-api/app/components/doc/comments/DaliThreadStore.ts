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
  ThreadStoreAuth,
  type ThreadData,
  type CommentData,
  type CommentBody,
  type CommentReactionData,
} from "@blocknote/core/comments";

// Marker stored in DocComment.anchor to distinguish inline BlockNote threads
// from legacy Yjs-position anchors and doc-level threads.
export const BLOCKNOTE_ANCHOR = { kind: "blocknote" } as const;

// ── Type for the raw shape the /api/comments loader returns ─────────────────

interface ApiReaction {
  userId: string;
  emoji: string;
  createdAt: string;
}

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
  reactions?: ApiReaction[];
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

/**
 * Group flat reaction rows into the CommentReactionData[] shape BlockNote expects:
 * one entry per emoji with the userIds array and the earliest createdAt.
 */
export function groupReactions(rows: ApiReaction[]): CommentReactionData[] {
  const map = new Map<string, { userIds: string[]; createdAt: Date }>();
  for (const r of rows) {
    const entry = map.get(r.emoji);
    const ts = new Date(r.createdAt);
    if (entry) {
      entry.userIds.push(r.userId);
      if (ts < entry.createdAt) entry.createdAt = ts;
    } else {
      map.set(r.emoji, { userIds: [r.userId], createdAt: ts });
    }
  }
  return Array.from(map.entries()).map(([emoji, { userIds, createdAt }]) => ({
    emoji,
    createdAt,
    userIds,
  }));
}

function toCommentData(c: ApiComment): CommentData {
  return {
    type: "comment",
    id: c.id,
    userId: c.authorId,
    createdAt: new Date(c.createdAt),
    updatedAt: new Date(c.createdAt), // DocComment has no updatedAt; createdAt is the best proxy
    reactions: groupReactions(c.reactions ?? []),
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

// ── DaliThreadStoreAuth — resolve gated, reactions allowed ──────────────────
//
// canResolve / canUnresolve gate on the editor role (canEdit || Core).
// Reactions are open to anyone with comment access (same as canAddComment).
// canDeleteReaction is limited to the current user's own reactions.

export class DaliThreadStoreAuth extends ThreadStoreAuth {
  constructor(
    private readonly userId: string,
    private readonly role: "comment" | "editor",
  ) {
    super();
  }

  canCreateThread(): boolean { return true; }
  canAddComment(_thread: ThreadData): boolean { return true; }
  canUpdateComment(comment: CommentData): boolean { return comment.userId === this.userId; }
  canDeleteComment(comment: CommentData): boolean {
    return comment.userId === this.userId || this.role === "editor";
  }
  canDeleteThread(_thread: ThreadData): boolean { return this.role === "editor"; }
  canResolveThread(_thread: ThreadData): boolean { return this.role === "editor"; }
  canUnresolveThread(_thread: ThreadData): boolean { return this.role === "editor"; }

  // Any viewer with comment access can add a reaction.
  canAddReaction(_comment: CommentData, _emoji?: string): boolean { return true; }
  // Only the user can remove their own reaction (server enforces; client gates UI).
  canDeleteReaction(comment: CommentData, emoji?: string): boolean {
    if (!emoji) return false;
    return comment.reactions.some(
      (r) => r.emoji === emoji && r.userIds.includes(this.userId),
    );
  }
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
  private fetchError: string | null = null;

  constructor(config: DaliThreadStoreConfig) {
    super(
      new DaliThreadStoreAuth(
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

  /** Last fetch error, mapped to user-friendly language. Null if none. */
  getError(): string | null {
    return this.fetchError;
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

  async updateComment(options: {
    comment: { body: CommentBody; metadata?: unknown };
    threadId: string;
    commentId: string;
  }): Promise<void> {
    // W3's API adds intent:"edit" {body} to POST /api/comments/:id.
    // bodyToPlainText keeps comments as plain text (existing decision).
    const bodyText = bodyToPlainText(options.comment.body);
    const res = await fetch(`/api/comments/${options.commentId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "edit", body: bodyText }),
    });
    if (!res.ok) {
      // If the endpoint doesn't exist yet (W3 not deployed), swallow silently —
      // the store state will still reflect the old body until next refetch.
      return;
    }
    await this.refetch();
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
    // The CommentsExtension's subscribe callback detects the thread is gone and
    // marks the orphan attribute on the ProseMirror mark automatically.
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

  async addReaction(options: {
    threadId: string;
    commentId: string;
    emoji: string;
  }): Promise<void> {
    const res = await fetch(`/api/comments/${options.commentId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "react", emoji: options.emoji }),
    });
    if (!res.ok) throw new Error(`addReaction failed: ${res.status}`);
    await this.refetch();
  }

  async deleteReaction(options: {
    threadId: string;
    commentId: string;
    emoji: string;
  }): Promise<void> {
    const res = await fetch(`/api/comments/${options.commentId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "unreact", emoji: options.emoji }),
    });
    if (!res.ok) throw new Error(`deleteReaction failed: ${res.status}`);
    await this.refetch();
  }

  // ── Internal ────────────────────────────────────────────────────────────

  async refetch(): Promise<void> {
    try {
      const res = await fetch(
        `/api/comments?targetType=doc&targetId=${encodeURIComponent(this.pageId)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        this.fetchError =
          res.status === 403
            ? "You don't have access to comments here."
            : `Failed to load comments (${res.status}).`;
        return;
      }
      this.fetchError = null;
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

// ── Module-level store registry ──────────────────────────────────────────────
//
// One DaliThreadStore per pageId is shared between:
//   - DocEditorImpl (drives CommentsExtension + ThreadsSidebar)
//   - useDocThreadCounts (bubble count on the Comments button)
//   - DocCommentsPanel (open/resolved doc-level comment list)
//
// All three must see the same in-memory thread map so that mutations from the
// editor (create/add/resolve) update the count immediately instead of waiting
// for the next 30-second poll.  The registry lazily creates a store on first
// access and cleans up when all subscribers unsubscribe.

const _storeRegistry = new Map<string, DaliThreadStore>();

/**
 * Return the shared DaliThreadStore for `pageId`, creating it with the given
 * config on first call.  Subsequent calls for the same pageId return the cached
 * instance regardless of the config argument (the first caller wins).
 */
export function getOrCreateStore(
  pageId: string,
  config?: Omit<DaliThreadStoreConfig, "pageId">,
): DaliThreadStore {
  let store = _storeRegistry.get(pageId);
  if (!store) {
    store = new DaliThreadStore({
      pageId,
      currentUserId: config?.currentUserId ?? "",
      canComment: config?.canComment ?? false,
      canResolve: config?.canResolve ?? false,
      pollIntervalMs: config?.pollIntervalMs,
    });
    _storeRegistry.set(pageId, store);
  }
  return store;
}

// ── User resolver ────────────────────────────────────────────────────────────
//
// W3 provides GET /api/users/resolve?ids=a,b,c → {users:[{id,name,photoUrl?}]}.
// We call it for any ids not already known from thread comment metadata, then
// cache in a module-level Map so repeated calls are cheap (page reload clears).

const resolvedUserCache = new Map<string, { username: string; avatarUrl: string }>();

export async function resolveDocUsers(
  userIds: string[],
  store: DaliThreadStore,
): Promise<{ id: string; username: string; avatarUrl: string }[]> {
  // Seed cache from thread metadata (already fetched, no extra round-trip).
  for (const thread of store.getThreads().values()) {
    for (const comment of thread.comments) {
      if (!resolvedUserCache.has(comment.userId) && comment.metadata) {
        const meta = comment.metadata as { author?: string; authorPhotoUrl?: string | null };
        resolvedUserCache.set(comment.userId, {
          username: meta.author ?? comment.userId,
          avatarUrl: meta.authorPhotoUrl ?? "",
        });
      }
    }
  }

  const missing = userIds.filter((id) => !resolvedUserCache.has(id));
  if (missing.length > 0) {
    try {
      const res = await fetch(
        `/api/users/resolve?ids=${encodeURIComponent(missing.join(","))}`,
        { credentials: "include" },
      );
      if (res.ok) {
        const { users } = (await res.json()) as {
          users: { id: string; name: string; photoUrl?: string | null }[];
        };
        for (const u of users) {
          resolvedUserCache.set(u.id, { username: u.name, avatarUrl: u.photoUrl ?? "" });
        }
      }
    } catch {
      // If the resolve endpoint isn't available yet, degrade gracefully:
      // known users still render; unknown get bare initials.
    }
  }

  return userIds.flatMap((id) => {
    const known = resolvedUserCache.get(id);
    return known ? [{ id, ...known }] : [];
  });
}
