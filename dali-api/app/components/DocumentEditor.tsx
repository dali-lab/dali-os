import { useCallback, useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { FileDown, Check, RotateCcw, Trash2 } from "lucide-react";
import { CollaborativeEditor, type CommentAnchor, type EditorApi, type TocHeading } from "./CollaborativeEditor";
import { PresenceProvider } from "./collab/PresenceProvider";
import { PresenceBar } from "./collab/PresenceBar";
import { CommentsRail, formatCommentDate, type Comment, type ThreadActions } from "./collab/CommentsRail";
import { TagPicker, type DocTag } from "./TagPicker";
import { MentionTextInput } from "./editor/MentionTextInput";
import { useEditMode, EditModeToggle } from "./EditModeToggle";
import { PageIconPicker } from "./editor/PageIconPicker";
import { PageCover } from "./editor/PageCover";
import { DocToc } from "./editor/DocToc";
import { relativeTime } from "~/lib/relative-time";

// Reusable, abstract document surface: a Notion-style large title, a
// collaborative rich-text body, lab tags, inline + doc-level comments, and
// PDF/Word export. Keyed off a Page id so it can be dropped onto any FreeForm
// page (project docs today; meeting notes / PRDs / etc. later) — it knows
// nothing about projects.
//
// The body lives in the collab room `doc:{pageId}:body` (same room the project
// overview/PRD already use). The title is the Page.title field, saved via
// onSaveTitle (debounced by the host's API).
export function DocumentEditor({
  pageId,
  initialTitle,
  collabToken,
  userName,
  currentUserId,
  photoUrl,
  subtitle,
  canEdit,
  tags,
  allTags,
  iconEmoji: initialIcon = null,
  coverImageUrl: initialCover = null,
  createdByName,
  lastEditedByName,
  updatedAt,
  focusMentionUserId,
  focusCommentId,
}: {
  pageId: string;
  initialTitle: string;
  collabToken: string | null;
  userName: string;
  currentUserId: string;
  photoUrl?: string | null;
  subtitle?: string | null;
  canEdit: boolean;
  tags: DocTag[];
  allTags: DocTag[];
  iconEmoji?: string | null;
  coverImageUrl?: string | null;
  createdByName?: string | null;
  lastEditedByName?: string | null;
  updatedAt?: string | null;
  // When set (arriving from a mention notification), scroll to + flash this
  // user's mention in the body once it syncs.
  focusMentionUserId?: string;
  // When set (arriving from a comment-mention notification), scroll to + flash
  // this comment in the rail.
  focusCommentId?: string;
}) {
  const revalidator = useRevalidator();
  // Read/edit gate: docs open in a clean reading view even for editors; the
  // header toggle or the first click/keystroke in the body flips to edit.
  const { editing, editMode, setEditMode } = useEditMode(canEdit);
  const [title, setTitle] = useState(initialTitle);
  const [savingTitle, setSavingTitle] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null);

  // Page chrome — optimistic local state, persisted via the documents API.
  const [iconEmoji, setIconEmoji] = useState<string | null>(initialIcon);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialCover);
  const [wordCount, setWordCount] = useState(0);
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const editorApiRef = useRef<EditorApi | null>(null);

  async function savePageMeta(patch: { iconEmoji?: string | null; coverImageUrl?: string | null }) {
    if (patch.iconEmoji !== undefined) setIconEmoji(patch.iconEmoji);
    if (patch.coverImageUrl !== undefined) setCoverImageUrl(patch.coverImageUrl);
    try {
      await fetch(`/api/documents/${pageId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      revalidator.revalidate();
    } catch (err) {
      console.error("[document] failed to save page metadata", err);
    }
  }

  // Bridge between the comments rail (owns the data) and the editor (needs the
  // anchors to highlight + a way to refetch after a new inline comment).
  const refreshRef = useRef<(() => void) | null>(null);
  const getThreadsRef = useRef<(() => Comment[]) | null>(null);
  const focusAnchorRef = useRef<((a: CommentAnchor) => void) | null>(null);
  const actionsRef = useRef<ThreadActions | null>(null);
  const [anchors, setAnchors] = useState<{ id: string; anchor: CommentAnchor }[]>([]);

  // Debounced title save.
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (titleTimer.current) clearTimeout(titleTimer.current); }, []);

  function onTitleChange(next: string) {
    setTitle(next);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      const trimmed = next.trim();
      if (!trimmed) return;
      setSavingTitle(true);
      try {
        await fetch(`/api/documents/${pageId}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        // Refresh breadcrumb / tab title elsewhere on the page.
        revalidator.revalidate();
        // This tab's own loader/tab-label refresh from the line above, but a
        // sibling tab showing this doc (e.g. the project hub's Documents
        // list, opened split-screen) has its own loader that only reruns in
        // response to its own actions. Tell the shell to relay this to every
        // open tab so any that care about this page can refresh themselves.
        if (typeof window !== "undefined" && window.self !== window.top) {
          window.parent.postMessage(
            { type: "dali:documentTitleChanged", pageId, title: trimmed },
            window.location.origin,
          );
        }
      } finally {
        setSavingTitle(false);
      }
    }, 600);
  }

  const registerRefresh = useCallback(
    (refresh: () => void, threads: () => Comment[], actions: ThreadActions) => {
      refreshRef.current = refresh;
      getThreadsRef.current = threads;
      actionsRef.current = actions;
      // Recompute the editor's highlight anchors from the latest root threads.
      const list = threads()
        .filter((c) => c.parentId === null && c.anchor && !c.resolved)
        .map((c) => ({ id: c.id, anchor: c.anchor as CommentAnchor }));
      setAnchors(list);
    },
    [],
  );

  // Renders inside the CollaborativeEditor's popover when an inline highlight
  // is clicked — reuses the rail's fetched data + mutation actions (via the
  // refs above) instead of duplicating fetch/mutate logic, so this stays a
  // thin read+act view rather than a second source of truth.
  function getThreadNode(id: string, close: () => void) {
    const all = getThreadsRef.current?.() ?? [];
    const root = all.find((c) => c.id === id && c.parentId === null);
    if (!root) return null;
    const replies = all.filter((c) => c.parentId === id);
    return (
      <InlineThreadPopover
        root={root}
        replies={replies}
        currentUserId={currentUserId}
        canComment={canEdit}
        actions={actionsRef.current}
        close={close}
      />
    );
  }

  const metaSegments = [
    createdByName ? `Created by ${createdByName}` : null,
    lastEditedByName || createdByName
      ? `Last edited by ${lastEditedByName ?? createdByName}`
      : null,
    updatedAt ? relativeTime(updatedAt) : null,
    `${wordCount} ${wordCount === 1 ? "word" : "words"}`,
  ].filter(Boolean);

  const body = (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="min-w-0">
        <PageCover
          coverImageUrl={coverImageUrl}
          editing={editing}
          onChange={(url) => savePageMeta({ coverImageUrl: url })}
        />
        {/* Notion-style title — large, bold, borderless; doubles as the doc
            title (Page.title). */}
        <div className="mb-3">
          <div className="flex items-center gap-3">
            <PageIconPicker
              iconEmoji={iconEmoji}
              editing={editing}
              onChange={(e) => savePageMeta({ iconEmoji: e })}
            />
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              disabled={!editing}
              placeholder="Untitled"
              aria-label="Document title"
              className="w-full font-heading text-3xl font-bold text-foreground bg-transparent border-none focus:outline-none placeholder:text-muted-foreground/50 disabled:opacity-100"
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
            <TagPicker
              targetType="doc"
              targetId={pageId}
              applied={tags}
              allTags={allTags}
              canEdit={editing}
              canCreate={editing}
              onChange={() => revalidator.revalidate()}
            />
            <div className="flex items-center gap-2 text-xs">
              {savingTitle && <span className="text-muted-foreground">Saving…</span>}
              <DocToc
                headings={headings}
                onJump={(ordinal) => editorApiRef.current?.scrollToHeading(ordinal)}
              />
              <PresenceBar />
              <EditModeToggle canEdit={canEdit} editMode={editMode} setEditMode={setEditMode} />
              <a
                href={`/documents/${pageId}/export?format=pdf`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <FileDown className="w-3.5 h-3.5" /> PDF
              </a>
              <a
                href={`/documents/${pageId}/export?format=docx`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <FileDown className="w-3.5 h-3.5" /> Word
              </a>
              <a
                href={`/documents/${pageId}/export?format=md`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <FileDown className="w-3.5 h-3.5" /> Markdown
              </a>
            </div>
          </div>
          {metaSegments.length > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">{metaSegments.join(" · ")}</p>
          )}
        </div>

        {collabToken ? (
          <CollaborativeEditor
            editorId={`doc:${pageId}:body`}
            documentName={`doc:${pageId}:body`}
            token={collabToken}
            userName={userName}
            disabled={!editing}
            onBeginEdit={canEdit ? () => setEditMode(true) : undefined}
            onWordCountChange={setWordCount}
            onHeadingsChange={setHeadings}
            onReady={(api) => {
              editorApiRef.current = api;
            }}
            enableMentions
            enableImages
            enableRichBlocks
            chromeless
            focusMentionUserId={focusMentionUserId}
            placeholder="Start writing…"
            className="min-h-[60vh]"
            inlineComments={{
              enabled: true,
              anchors,
              onRequestComment: (a) => setPendingAnchor(a),
              onReady: (api) => {
                focusAnchorRef.current = api.focusAnchor;
              },
              getThreadNode,
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Sign in again to edit this document.
          </p>
        )}
      </div>

      <aside className="lg:border-l lg:border-border lg:pl-6">
        <CommentsRail
          targetType="doc"
          targetId={pageId}
          currentUserId={currentUserId}
          canComment={canEdit}
          pendingAnchor={pendingAnchor}
          onClearPendingAnchor={() => setPendingAnchor(null)}
          onFocusAnchor={(a) => focusAnchorRef.current?.(a)}
          registerRefresh={registerRefresh}
          focusCommentId={focusCommentId}
        />
      </aside>
    </div>
  );

  // Provider wraps the whole surface so PresenceBar (in the header row) and
  // the editor share one presence room.
  return collabToken ? (
    <PresenceProvider
      pageId={`doc:${pageId}`}
      token={collabToken}
      userName={userName}
      userId={currentUserId}
      photoUrl={photoUrl}
      subtitle={subtitle}
    >
      {body}
    </PresenceProvider>
  ) : (
    body
  );
}

// Compact single-thread view rendered inside the editor's floating popover
// (see getThreadNode above). Read + act, not a second source of truth: data
// comes from the rail's live fetch, mutations go through the rail's own
// actions, so both views update from the same refresh.
function InlineThreadPopover({
  root,
  replies,
  currentUserId,
  canComment,
  actions,
  close,
}: {
  root: Comment;
  replies: Comment[];
  currentUserId: string;
  canComment: boolean;
  actions: ThreadActions | null;
  close: () => void;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-2 p-3 text-sm max-h-96 overflow-y-auto">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">{root.author}</span>
          <span className="text-[10px] text-muted-foreground">{formatCommentDate(root.createdAt)}</span>
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">{root.body}</p>
      </div>

      {replies.map((r) => (
        <div key={r.id} className="ml-3 pl-2 border-l border-border">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground">{r.author}</span>
            <span className="text-[10px] text-muted-foreground">{formatCommentDate(r.createdAt)}</span>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap mt-0.5">{r.body}</p>
        </div>
      ))}

      {canComment && (
        <>
          <div className="flex items-end gap-1">
            <MentionTextInput
              autoFocus
              value={replyDraft}
              onChange={setReplyDraft}
              placeholder="Reply… "
              wrapperClassName="relative flex-1"
              className="w-full px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-accent-coral/40"
              onKeyDown={async (e) => {
                if (e.key !== "Enter" || !replyDraft.trim()) return;
                e.preventDefault();
                setBusy(true);
                const ok = await actions?.reply(root.id, replyDraft.trim());
                setBusy(false);
                if (ok) setReplyDraft("");
              }}
            />
            <button
              type="button"
              disabled={busy || !replyDraft.trim()}
              onClick={async () => {
                setBusy(true);
                const ok = await actions?.reply(root.id, replyDraft.trim());
                setBusy(false);
                if (ok) setReplyDraft("");
              }}
              className="text-xs px-2 py-1 rounded bg-accent-coral text-white disabled:opacity-50"
            >
              Reply
            </button>
          </div>

          <div className="flex items-center gap-3 pt-1 border-t border-border">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await actions?.resolve(root.id, !root.resolved);
                setBusy(false);
                close();
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
            >
              {root.resolved ? <><RotateCcw className="w-3 h-3" /> Reopen</> : <><Check className="w-3 h-3" /> Resolve</>}
            </button>
            {root.authorId === currentUserId && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await actions?.remove(root.id);
                  setBusy(false);
                  close();
                }}
                className="text-[11px] text-destructive hover:underline flex items-center gap-0.5"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
