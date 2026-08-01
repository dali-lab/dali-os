import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRevalidator } from "react-router";
import { History, MessageSquare, MoreHorizontal, FileDown } from "lucide-react";
import { DocEditor, type TocHeading } from "~/components/doc";
import { DocCommentsPanel, useDocThreadCounts } from "~/components/doc/comments";
import { pageDocName } from "~/collab/roomName";
import { PresenceProvider } from "./collab/PresenceProvider";
import { PresenceBar } from "./collab/PresenceBar";
import { VersionHistoryPanel } from "./collab/VersionHistoryPanel";
import { TagPicker, type DocTag } from "./TagPicker";
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
// The body lives in the collab room `doc:{pageId}:body`. The title is the
// Page.title field, saved via a debounced API call.
//
// Edit mode is GONE: the editor renders once with editable={canEdit}. There is
// no pencil, no "Done editing", no read/edit reflow. Read-only users see the
// same layout, inert.
export function DocumentEditor({
  pageId,
  initialTitle,
  collabToken,
  userName,
  currentUserId,
  photoUrl,
  subtitle,
  canEdit,
  canComment,
  canResolve,
  tags,
  allTags,
  iconEmoji: initialIcon = null,
  coverImageUrl: initialCover = null,
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
  canComment: boolean;
  canResolve: boolean;
  tags: DocTag[];
  allTags: DocTag[];
  iconEmoji?: string | null;
  coverImageUrl?: string | null;
  updatedAt?: string | null;
  // When set (arriving from a comment-mention notification), open the comments
  // panel and scroll to this comment.
  focusCommentId?: string;
}) {
  const revalidator = useRevalidator();
  const [title, setTitle] = useState(initialTitle);
  const [savingTitle, setSavingTitle] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(!!focusCommentId);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [locallyEdited, setLocallyEdited] = useState(false);

  // Page chrome — optimistic local state, persisted via the documents API.
  const [iconEmoji, setIconEmoji] = useState<string | null>(initialIcon);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialCover);
  const [wordCount, setWordCount] = useState(0);
  const [headings, setHeadings] = useState<TocHeading[]>([]);

  const documentName = pageDocName(pageId);

  // Open comments panel when ?comment= deep-link arrives.
  useEffect(() => {
    if (focusCommentId) setCommentsOpen(true);
  }, [focusCommentId]);

  const { open: openThreadCount } = useDocThreadCounts(pageId);

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
    setLocallyEdited(true);
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
        // Relay to sibling tabs (e.g. a project hub opened split-screen).
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

  const bodyRef = useRef<HTMLDivElement | null>(null);

  // ToC jump — ordinals from the block tree, re-resolved on live DOM.
  const jumpToHeading = useCallback((ordinal: number) => {
    const root = bodyRef.current;
    if (!root) return;
    const headingEls = Array.from(
      root.querySelectorAll('[data-content-type="heading"]'),
    ).filter((el) => Number(el.getAttribute("data-level") ?? "1") <= 3);
    headingEls[ordinal]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Title contenteditable ref — needed to focus from the editor's back-tab.
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  // "Enter" in the title moves focus into the first editor block.
  function onTitleKeyDown(e: KeyboardEvent<HTMLHeadingElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Focus the BlockNote editor's first block. BlockNote's root div carries
      // [data-bn-editor] or we just target the .ProseMirror element it renders.
      const editorEl = bodyRef.current?.querySelector<HTMLElement>(
        "[contenteditable='true']",
      );
      editorEl?.focus();
    }
  }

  // ⋯ More menu dismiss on outside click.
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moreMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreMenuOpen]);

  const editedLabel = locallyEdited
    ? "Edited just now"
    : updatedAt
      ? `Edited ${relativeTime(updatedAt)}`
      : null;

  // ── Top bar ───────────────────────────────────────────────────────────────
  const topBar = (
    <div className="doc-topbar flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
      {/* Breadcrumb/back rendered by the outer shell — we just add meta here */}
      {editedLabel && (
        <span className="shrink-0">{editedLabel}</span>
      )}
      {savingTitle && <span className="shrink-0 italic">Saving…</span>}

      <div className="flex-1" />

      {/* Presence chips */}
      <PresenceBar />

      {/* ToC control */}
      <DocToc headings={headings} onJump={jumpToHeading} />

      {/* Comments bubble */}
      {(canComment || openThreadCount > 0) && (
        <button
          type="button"
          onClick={() => setCommentsOpen((o) => !o)}
          aria-pressed={commentsOpen}
          aria-label={`Comments${openThreadCount > 0 ? ` (${openThreadCount} open)` : ""}`}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${
            commentsOpen
              ? "border-accent-coral/40 bg-accent-coral/10 text-accent-coral"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {openThreadCount > 0 && <span>{openThreadCount}</span>}
        </button>
      )}

      {/* ⋯ More menu */}
      <div ref={moreMenuRef} className="relative">
        <button
          type="button"
          onClick={() => setMoreMenuOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={moreMenuOpen}
          aria-label="More options"
          className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {moreMenuOpen && (
          <div className="absolute right-0 z-30 mt-1 w-52 rounded-md border border-border bg-card p-1 shadow-brand-2 text-sm">
            {collabToken && (
              <button
                type="button"
                onClick={() => { setHistoryOpen(true); setMoreMenuOpen(false); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted"
              >
                <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                Version history
              </button>
            )}
            <div className="my-1 border-t border-border" />
            <a
              href={`/documents/${pageId}/export?format=pdf`}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-foreground hover:bg-muted"
              onClick={() => setMoreMenuOpen(false)}
            >
              <FileDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Export as PDF
            </a>
            <a
              href={`/documents/${pageId}/export?format=docx`}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-foreground hover:bg-muted"
              onClick={() => setMoreMenuOpen(false)}
            >
              <FileDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Export as Word
            </a>
            <a
              href={`/documents/${pageId}/export?format=md`}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-foreground hover:bg-muted"
              onClick={() => setMoreMenuOpen(false)}
            >
              <FileDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Export as Markdown
            </a>
            <div className="my-1 border-t border-border" />
            <div className="px-2 py-1.5 text-muted-foreground text-xs tabular-nums">
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ── Paper canvas ──────────────────────────────────────────────────────────
  const canvas = (
    <div className="doc-canvas-outer flex justify-center px-4 pb-12 pt-4">
      <div className="doc-canvas w-full max-w-[868px] rounded-xl border border-border bg-card shadow-brand-1">
        {/* Cover lives at the top edge of the canvas, full-bleed */}
        <PageCover
          coverImageUrl={coverImageUrl}
          canEdit={canEdit}
          onChange={(url) => savePageMeta({ coverImageUrl: url })}
        />

        <div className="px-[54px] pt-12 pb-6">
          {/* Hover-reveal row: icon · Add icon · Add cover · Add tag */}
          <div className="group/header relative mb-1">
            {/* Always-rendered icon (when set) or Add-icon affordance */}
            <div className="mb-2">
              <PageIconPicker
                iconEmoji={iconEmoji}
                canEdit={canEdit}
                onChange={(e) => savePageMeta({ iconEmoji: e })}
              />
            </div>

            {/* Hover-reveal affordance row — reserved height, opacity-transitions */}
            {canEdit && (
              <div className="flex items-center gap-1 h-6 mb-2 opacity-0 transition-opacity duration-150 group-hover/header:opacity-100">
                {!iconEmoji && (
                  <PageIconPicker
                    iconEmoji={null}
                    canEdit={true}
                    onChange={(e) => savePageMeta({ iconEmoji: e })}
                  />
                )}
                {!coverImageUrl && (
                  <PageCover
                    coverImageUrl={null}
                    canEdit={true}
                    onChange={(url) => savePageMeta({ coverImageUrl: url })}
                  />
                )}
              </div>
            )}

            {/* Title */}
            {canEdit ? (
              <h1
                ref={titleRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="Document title"
                aria-multiline="false"
                data-placeholder="Untitled"
                onInput={(e) => onTitleChange((e.currentTarget.textContent ?? "").replace(/\n/g, ""))}
                onKeyDown={onTitleKeyDown}
                className="doc-title-editable block w-full font-heading text-[40px] font-bold leading-tight text-foreground outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50"
              >
                {title}
              </h1>
            ) : (
              <h1 className="font-heading text-[40px] font-bold leading-tight text-foreground select-text">
                {title}
              </h1>
            )}

            {/* Tags row — just below the title */}
            <div className="mt-3">
              <TagPicker
                targetType="doc"
                targetId={pageId}
                applied={tags}
                allTags={allTags}
                canEdit={canEdit}
                canCreate={canEdit}
                onChange={() => revalidator.revalidate()}
              />
            </div>
          </div>

          {/* Body */}
          <div className="mt-4" ref={bodyRef}>
            {collabToken ? (
              <DocEditor
                features="document"
                editable={canEdit}
                collab={{
                  documentName,
                  token: collabToken,
                  userName,
                  userId: currentUserId,
                }}
                comments={{
                  pageId,
                  currentUserId,
                  canComment,
                  canResolve,
                  panelOpen: commentsOpen,
                  panelTargetId: "doc-comments-panel",
                }}
                onWordCountChange={setWordCount}
                onHeadingsChange={setHeadings}
                onChange={() => setLocallyEdited(true)}
                placeholder="Write something, or press '/' for commands"
                className="min-h-[70vh]"
              />
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Sign in again to edit this document.
              </p>
            )}

            {/* Empty read state: visible only when read-only + no content yet.
                Word count starts at 0 before the collab doc loads, so we also
                wait for a mounted collab connection (collabToken present). */}
            {!canEdit && collabToken && wordCount === 0 && (
              <p className="mt-12 text-center text-sm text-muted-foreground/60 italic select-none">
                This page is empty.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Version history ───────────────────────────────────────────────────────
  const versionHistory = historyOpen && (
    <VersionHistoryPanel
      documentName={documentName}
      onClose={() => setHistoryOpen(false)}
    />
  );

  // ── Comments panel (right slide-over) ────────────────────────────────────
  const commentsPanel = (
    <DocCommentsPanel
      pageId={pageId}
      currentUserId={currentUserId}
      canComment={canComment}
      canResolve={canResolve}
      open={commentsOpen}
      onClose={() => setCommentsOpen(false)}
      targetId="doc-comments-panel"
    />
  );

  const body = (
    <div className="doc-surface flex flex-col min-h-screen">
      {topBar}
      {canvas}
      {versionHistory}
      {commentsPanel}
    </div>
  );

  // Provider wraps the whole surface so PresenceBar (in the top bar) and the
  // editor share one presence room.
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
