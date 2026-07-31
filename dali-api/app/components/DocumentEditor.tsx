import { useCallback, useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { FileDown, History } from "lucide-react";
import { DocEditor, type TocHeading } from "~/components/doc";
import { pageDocName } from "~/collab/roomName";
import { PresenceProvider } from "./collab/PresenceProvider";
import { PresenceBar } from "./collab/PresenceBar";
import { CommentsRail } from "./collab/CommentsRail";
import { VersionHistoryPanel } from "./collab/VersionHistoryPanel";
import { TagPicker, type DocTag } from "./TagPicker";
import { useEditMode, EditModeToggle } from "./EditModeToggle";
import { PageIconPicker } from "./doc-chrome/PageIconPicker";
import { PageCover } from "./doc-chrome/PageCover";
import { DocToc } from "./doc-chrome/DocToc";
import { relativeTime } from "~/lib/relative-time";

// Reusable, abstract document surface: a Notion-style large title, a
// collaborative rich-text body, lab tags, doc-level comments, and PDF/Word
// export. Keyed off a Page id so it can be dropped onto any FreeForm page
// (project docs today; meeting notes / PRDs / etc. later) — it knows nothing
// about projects.
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
  // When set (arriving from a comment-mention notification), scroll to + flash
  // this comment in the rail.
  focusCommentId?: string;
}) {
  const revalidator = useRevalidator();
  // Read/edit gate: docs open in a clean reading view even for editors; the
  // header toggle flips to edit.
  const { editing, editMode, setEditMode } = useEditMode(canEdit);
  const [title, setTitle] = useState(initialTitle);
  const [savingTitle, setSavingTitle] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Page chrome — optimistic local state, persisted via the documents API.
  const [iconEmoji, setIconEmoji] = useState<string | null>(initialIcon);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialCover);
  const [wordCount, setWordCount] = useState(0);
  const [headings, setHeadings] = useState<TocHeading[]>([]);

  const documentName = pageDocName(pageId);

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

  // Jump from the CommentsRail to a BlockNote inline thread mark in the editor.
  // BlockNote renders comment marks as <span data-bn-thread-id="..."> elements.
  const jumpToInlineThread = useCallback((threadId: string) => {
    const root = bodyRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-bn-thread-id="${CSS.escape(threadId)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Flash the mark by briefly toggling a class (reuses the existing mention-
    // flash keyframe animation defined in app.css).
    el.classList.add("mention-flash");
    setTimeout(() => el.classList.remove("mention-flash"), 2600);
  }, []);

  // ToC jump. Ordinals come from the block tree (H1–H3, in traversal order —
  // see extractHeadings); BlockNote renders each heading block as a
  // [data-content-type="heading"] element in the same order, so re-resolving
  // the ordinal against the live DOM stays correct as peers edit the doc.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const jumpToHeading = useCallback((ordinal: number) => {
    const root = bodyRef.current;
    if (!root) return;
    const headingEls = Array.from(
      root.querySelectorAll('[data-content-type="heading"]'),
    ).filter((el) => Number(el.getAttribute("data-level") ?? "1") <= 3);
    headingEls[ordinal]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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
              <DocToc headings={headings} onJump={jumpToHeading} />
              <PresenceBar />
              <EditModeToggle canEdit={canEdit} editMode={editMode} setEditMode={setEditMode} />
              {collabToken && (
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  title="Version history"
                  aria-label="Version history"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <History className="w-3.5 h-3.5" />
                </button>
              )}
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
          <div ref={bodyRef}>
            <DocEditor
              features="document"
              editable={editing}
              collab={{
                documentName,
                token: collabToken,
                userName,
                userId: currentUserId,
              }}
              comments={{
                pageId,
                currentUserId,
                canComment: canEdit,
                canResolve: canEdit,
              }}
              onWordCountChange={setWordCount}
              onHeadingsChange={setHeadings}
              placeholder="Write something, or press '/' for commands"
              className="min-h-[60vh]"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Sign in again to edit this document.
          </p>
        )}

        {historyOpen && (
          <VersionHistoryPanel
            documentName={documentName}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </div>

      <aside className="lg:border-l lg:border-border lg:pl-6">
        <CommentsRail
          targetType="doc"
          targetId={pageId}
          currentUserId={currentUserId}
          canComment={canEdit}
          focusCommentId={focusCommentId}
          onFocusInlineThread={jumpToInlineThread}
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
