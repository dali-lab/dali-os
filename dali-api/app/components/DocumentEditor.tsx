import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useRevalidator } from "react-router";
import { History, MessageSquare, MoreHorizontal, FileDown, Printer, Upload } from "lucide-react";
import { DocEditor, type TocHeading } from "~/components/doc";
import type { DocEditorInstance } from "~/components/doc/schema/build";
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
  // Editor instance captured via onEditorReady — used for the Import Markdown action.
  const editorRef = useRef<DocEditorInstance | null>(null);
  // Hidden file input for the Import Markdown menu action.
  const mdImportInputRef = useRef<HTMLInputElement | null>(null);
  // FIX 5: title is uncontrolled — we never feed state back into the DOM while
  // the h1 is focused, which prevents caret-at-0 "backwards typing" caused by
  // React re-rendering contentEditable with the controlled value on every input.
  // pendingTitle ref tracks the latest text for the debounced save; the DOM is
  // the single source of truth while the user is typing.
  const [savingTitle, setSavingTitle] = useState(false);
  const pendingTitleRef = useRef(initialTitle);
  const titleFocusedRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(!!focusCommentId);
  const [panelFilter, setPanelFilter] = useState<"open" | "resolved">("open");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const commentsBubbleRef = useRef<HTMLDivElement | null>(null);
  const [locallyEdited, setLocallyEdited] = useState(false);
  // "Aa" formatting popover (replaced the static-toolbar toggle). Stays open
  // while the user works in the editor — dismissed by the Aa button, Escape,
  // or clicking other chrome; clicks inside the editor body do NOT close it,
  // so select-then-format round trips don't need reopening.
  const [formatOpen, setFormatOpen] = useState(false);
  const formatRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!formatOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (formatRef.current?.contains(t)) return;
      if (t.closest(".bn-editor")) return;
      setFormatOpen(false);
    };
    // globalThis: the React KeyboardEvent type import shadows the DOM one.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setFormatOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [formatOpen]);

  const { open: openThreadCount } = useDocThreadCounts(pageId);

  // ── Rail (wide-screen comments column) ───────────────────────────────────
  // canvasContainerRef: the flex row that holds the paper + rail.
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  // paperCardRef: the bg-card paper element (also used as the rail's canvasRef).
  const paperCardRef = useRef<HTMLDivElement | null>(null);

  // Whether the container is wide enough for the rail (≥ 1150px).
  const [containerWide, setContainerWide] = useState(false);

  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.offsetWidth;
      setContainerWide(w >= 1150);
    });
    ro.observe(el);
    // Seed immediately without waiting for a resize event.
    setContainerWide(el.offsetWidth >= 1150);
    return () => ro.disconnect();
  }, []);

  // Rail visibility: persisted in localStorage, default visible when wide + has open threads.
  const [railUserVisible, setRailUserVisible] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem("dali-doc-rail-visible");
    if (stored === "0") return false;
    if (stored === "1") return true;
    return null; // null = use default (open when threads exist)
  });

  // Effective rail visibility: wide + user pref (default: visible when there are open threads).
  const railVisible =
    containerWide &&
    (railUserVisible === null ? openThreadCount > 0 : railUserVisible);

  function toggleRail() {
    if (containerWide) {
      setRailUserVisible((v) => {
        const next = !(v === null ? openThreadCount > 0 : v);
        localStorage.setItem("dali-doc-rail-visible", next ? "1" : "0");
        return next;
      });
    } else {
      // Narrow: toggle the existing dropdown.
      setCommentsOpen((o) => !o);
    }
  }

  const [railFilter, setRailFilter] = useState<"open" | "resolved">("open");

  const RAIL_TARGET_ID = "doc-comments-rail";

  // Page chrome — optimistic local state, persisted via the documents API.
  const [iconEmoji, setIconEmoji] = useState<string | null>(initialIcon);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(initialCover);
  const [wordCount, setWordCount] = useState(0);
  const [headings, setHeadings] = useState<TocHeading[]>([]);

  const documentName = pageDocName(pageId);

  // Deep-link: when rail is visible, select the thread there; otherwise open dropdown.
  useEffect(() => {
    if (!focusCommentId) return;
    if (containerWide) {
      // Rail handles selection via selectThread — ensure rail is visible.
      setRailUserVisible(true);
    } else {
      setCommentsOpen(true);
    }
  }, [focusCommentId, containerWide]);

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

  // Debounced title save — fires at most once per 800ms burst.
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (titleTimer.current) clearTimeout(titleTimer.current); }, []);

  // FIX 5: read textContent from the DOM directly (not React state) to avoid
  // feeding state back into the controlled h1 which resets the caret to 0.
  function scheduleTitleSave(text: string) {
    pendingTitleRef.current = text;
    setLocallyEdited(true);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      const trimmed = pendingTitleRef.current.trim();
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
    }, 800);
  }

  // FIX 5: Set the h1 DOM text once on mount and when pageId changes (cross-tab
  // navigation). When NOT focused, also accept external title updates (e.g. from
  // postMessage relay). Never write to the DOM while the user is typing — doing
  // so resets the caret to offset 0.
  useLayoutEffect(() => {
    if (titleRef.current) {
      titleRef.current.textContent = initialTitle;
      pendingTitleRef.current = initialTitle;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

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

  // Import Markdown: reads the picked .md/.markdown/.txt file client-side,
  // converts to blocks via editor.tryParseMarkdownToBlocks (BlockNote 0.52 API —
  // synchronous), then replaces an empty doc or appends to an existing one.
  // Both replaceBlocks/insertBlocks are single ProseMirror transactions so the
  // entire import is one undo step.
  async function handleMarkdownImport(file: File) {
    const editor = editorRef.current;
    if (!editor) return;
    const text = await file.text();
    const newBlocks = editor.tryParseMarkdownToBlocks(text);
    if (!newBlocks.length) return;

    const doc = editor.document;
    const isEmpty =
      doc.length === 1 &&
      doc[0].type === "paragraph" &&
      (!Array.isArray(doc[0].content) || doc[0].content.length === 0);

    if (isEmpty) {
      // Replace the single empty paragraph.
      editor.replaceBlocks(editor.document, newBlocks);
    } else {
      // Append after the last block.
      const lastBlock = doc[doc.length - 1];
      editor.insertBlocks(newBlocks, lastBlock, "after");
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

  // Narrow-mode dropdown dismiss on outside click.
  useEffect(() => {
    if (!commentsOpen || containerWide) return;
    const onDown = (e: MouseEvent) => {
      if (commentsBubbleRef.current && !commentsBubbleRef.current.contains(e.target as Node)) {
        setCommentsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [commentsOpen, containerWide]);

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

      {/* "Aa" text-format popover — visible standard text options without the
          old static-bar mode. onMouseDown preventDefault keeps the editor
          selection alive when the button is clicked. */}
      {canEdit && (
        <div ref={formatRef} className="relative">
          <button
            type="button"
            onClick={() => setFormatOpen((o) => !o)}
            onMouseDown={(e) => e.preventDefault()}
            aria-pressed={formatOpen}
            aria-label="Text formatting"
            className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
              formatOpen
                ? "border-accent-coral/40 bg-accent-coral/10 text-accent-coral"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Aa
          </button>
          {formatOpen && (
            <div
              id="doc-format-popover"
              // bn-root + bn-shadcn: BlockNote component styling requires an
              // ancestor with these classes (same as the panel/rail targets).
              // No mousedown preventDefault here: the link button's URL input
              // needs real focus, and toolbar commands act on the editor's
              // STATE selection, which survives the editor blurring.
              className="dali-doc-format-popover bn-root bn-shadcn absolute right-0 top-full z-30 mt-1 w-max max-w-[360px] rounded-md border border-border bg-card p-2 shadow-brand-2"
            />
          )}
        </div>
      )}

      {/* Comments bubble → rail toggle (wide) or compact dropdown (narrow) */}
      {(canComment || openThreadCount > 0) && (
        <div ref={commentsBubbleRef} className="relative">
          <button
            type="button"
            onClick={toggleRail}
            aria-pressed={containerWide ? railVisible : commentsOpen}
            aria-label={`Comments${openThreadCount > 0 ? ` (${openThreadCount} open)` : ""}`}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors ${
              (containerWide ? railVisible : commentsOpen)
                ? "border-accent-coral/40 bg-accent-coral/10 text-accent-coral"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {openThreadCount > 0 && <span>{openThreadCount}</span>}
          </button>
          {/* Dropdown only on narrow screens */}
          {!containerWide && commentsOpen && (
            <DocCommentsPanel
              pageId={pageId}
              currentUserId={currentUserId}
              canComment={canComment}
              canResolve={canResolve}
              open={commentsOpen}
              onClose={() => setCommentsOpen(false)}
              targetId="doc-comments-panel"
              onFilterChange={setPanelFilter}
            />
          )}
        </div>
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
            <button
              type="button"
              onClick={() => { window.print(); setMoreMenuOpen(false); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted"
            >
              <Printer className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Print / Save as PDF
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => { mdImportInputRef.current?.click(); setMoreMenuOpen(false); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted"
              >
                <Upload className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                Import Markdown
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
  // SMALL B: bg-page tint token for light-mode canvas contrast (mirrors dark)
  const canvas = (
    <div
      ref={canvasContainerRef}
      className="doc-canvas-outer flex justify-center gap-6 px-6 pb-12 pt-4 bg-page"
    >
      {/* Paper card — shrinks to make room for the rail when wide */}
      <div
        ref={paperCardRef}
        className={`doc-canvas rounded-xl border border-border bg-card shadow-brand-1 ${
          railVisible ? "flex-1 min-w-0" : "w-full max-w-[1400px]"
        }`}
      >
        {/* Cover lives at the top edge of the canvas, full-bleed.
            FIX 6: Only render PageCover here when a cover IS set (so it shows
            the image + change/remove controls). When no cover, the hover-reveal
            row below owns the "Add cover" affordance — rendering PageCover here
            with no cover would produce a second "Add cover" button. */}
        {coverImageUrl && (
          <PageCover
            coverImageUrl={coverImageUrl}
            canEdit={canEdit}
            onChange={(url) => savePageMeta({ coverImageUrl: url })}
          />
        )}

        <div className="px-[54px] pt-12 pb-6">
          {/* Hover-reveal row: icon · Add icon · Add cover · Add tag
              The header/title block adds an extra pl-[54px] to match the body
              text, which sits at the 54px outer padding PLUS BlockNote's own
              54px .bn-editor drag-handle gutter (padding-inline:54px in core
              CSS). Together that puts both at 108px from the card edge (±0). */}
          <div className="group/header relative mb-1 pl-[54px]">
            {/* FIX 6: One source of truth for the icon + cover affordances.
                - When icon IS set: show it always (not in the hover row).
                - When icon is NOT set: show "Add icon" only in the hover row.
                - When cover is NOT set: show "Add cover" only in the hover row.
                The hover-reveal row is always reserved (h-6) so the title does
                not shift when hovering; items appear with opacity transition. */}
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

            {/* Title — FIX 5: rendered uncontrolled (no children re-rendered
                from state) so React never resets textContent mid-keystroke.
                useLayoutEffect seeds DOM text on mount/pageId change. */}
            <div className="flex items-start gap-3">
              {iconEmoji && (
                // h-[50px] = the title's first-line height (40px × 1.25
                // leading-tight), so the icon stays centered on line one even
                // when the title wraps.
                <div className="flex h-[50px] shrink-0 items-center">
                  <PageIconPicker
                    iconEmoji={iconEmoji}
                    canEdit={canEdit}
                    onChange={(e) => savePageMeta({ iconEmoji: e })}
                  />
                </div>
              )}
              {canEdit ? (
                <h1
                  ref={titleRef}
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-label="Document title"
                  aria-multiline="false"
                  data-placeholder="Untitled"
                  onFocus={() => { titleFocusedRef.current = true; }}
                  onBlur={(e) => {
                    titleFocusedRef.current = false;
                    // Save on blur in addition to the debounce.
                    const text = (e.currentTarget.textContent ?? "").replace(/\n/g, "");
                    scheduleTitleSave(text);
                  }}
                  onInput={(e) => scheduleTitleSave((e.currentTarget.textContent ?? "").replace(/\n/g, ""))}
                  onKeyDown={onTitleKeyDown}
                  className="doc-title-editable min-w-0 flex-1 font-heading text-[40px] font-bold leading-tight text-foreground outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50"
                />
              ) : (
                <h1 className="min-w-0 flex-1 font-heading text-[40px] font-bold leading-tight text-foreground select-text">
                  {initialTitle}
                </h1>
              )}
            </div>

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

          {/* Hidden file input for "Import Markdown" ⋯ menu action.
              Accepts .md/.markdown/.txt; value is reset after each pick so
              selecting the same file twice still triggers onChange. */}
          <input
            ref={mdImportInputRef}
            type="file"
            accept=".md,.markdown,.txt,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) handleMarkdownImport(file).catch(console.error);
            }}
          />

          {/* Body */}
          <div className="mt-4" ref={bodyRef}>
            {collabToken ? (
              <DocEditor
                features="document"
                editable={canEdit}
                onEditorReady={(editor) => { editorRef.current = editor; }}
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
                  panelOpen: !containerWide && commentsOpen,
                  panelTargetId: "doc-comments-dropdown",
                  panelFilter: railVisible ? railFilter : panelFilter,
                  railVisible,
                  railTargetId: RAIL_TARGET_ID,
                  editorContentRef: paperCardRef as RefObject<HTMLElement | null>,
                  onRailFilterChange: setRailFilter,
                  focusCommentId,
                }}
                formatPopoverOpen={formatOpen}
                formatPopoverTargetId="doc-format-popover"
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

      {/* Right-hand comments rail — only rendered when the container is wide */}
      {railVisible && (
        <div
          id={RAIL_TARGET_ID}
          className="dali-doc-rail-container bn-root bn-shadcn"
          aria-label="Comments rail"
        />
      )}
    </div>
  );

  // ── Version history ───────────────────────────────────────────────────────
  const versionHistory = historyOpen && (
    <VersionHistoryPanel
      documentName={documentName}
      onClose={() => setHistoryOpen(false)}
    />
  );

  const body = (
    <div className="doc-surface flex flex-col min-h-screen">
      {topBar}
      {canvas}
      {versionHistory}
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
