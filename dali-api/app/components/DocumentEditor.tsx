import { useCallback, useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { FileDown } from "lucide-react";
import { CollaborativeEditor, type CommentAnchor } from "./CollaborativeEditor";
import { PresenceProvider } from "./collab/PresenceProvider";
import { PresenceBar } from "./collab/PresenceBar";
import { CommentsRail, type Comment } from "./collab/CommentsRail";
import { TagPicker, type DocTag } from "./TagPicker";

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
}) {
  const revalidator = useRevalidator();
  const [title, setTitle] = useState(initialTitle);
  const [savingTitle, setSavingTitle] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null);

  // Bridge between the comments rail (owns the data) and the editor (needs the
  // anchors to highlight + a way to refetch after a new inline comment).
  const refreshRef = useRef<(() => void) | null>(null);
  const getThreadsRef = useRef<(() => Comment[]) | null>(null);
  const focusAnchorRef = useRef<((a: CommentAnchor) => void) | null>(null);
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
      } finally {
        setSavingTitle(false);
      }
    }, 600);
  }

  const registerRefresh = useCallback(
    (refresh: () => void, threads: () => Comment[]) => {
      refreshRef.current = refresh;
      getThreadsRef.current = threads;
      // Recompute the editor's highlight anchors from the latest root threads.
      const list = threads()
        .filter((c) => c.parentId === null && c.anchor && !c.resolved)
        .map((c) => ({ id: c.id, anchor: c.anchor as CommentAnchor }));
      setAnchors(list);
    },
    [],
  );

  const body = (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="min-w-0">
        {/* Notion-style title — large, bold, borderless; doubles as the doc
            title (Page.title). */}
        <div className="mb-3">
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            disabled={!canEdit}
            placeholder="Untitled"
            aria-label="Document title"
            className="w-full font-heading text-3xl font-bold text-foreground bg-transparent border-none focus:outline-none placeholder:text-muted-foreground/50 disabled:opacity-100"
          />
          <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
            <TagPicker
              targetType="doc"
              targetId={pageId}
              applied={tags}
              allTags={allTags}
              canEdit={canEdit}
              canCreate={canEdit}
              onChange={() => revalidator.revalidate()}
            />
            <div className="flex items-center gap-2 text-xs">
              {savingTitle && <span className="text-muted-foreground">Saving…</span>}
              <PresenceBar />
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
            </div>
          </div>
        </div>

        {collabToken ? (
          <CollaborativeEditor
            editorId={`doc:${pageId}:body`}
            documentName={`doc:${pageId}:body`}
            token={collabToken}
            userName={userName}
            disabled={!canEdit}
            placeholder="Start writing…"
            className="min-h-[60vh]"
            inlineComments={{
              enabled: true,
              anchors,
              onRequestComment: (a) => setPendingAnchor(a),
              onReady: (api) => {
                focusAnchorRef.current = api.focusAnchor;
              },
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
