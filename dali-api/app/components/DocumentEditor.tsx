import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useNavigate, useRevalidator } from "react-router";
import { Copy, FileDown, FolderInput, History, LayoutTemplate, Link, MessageSquare, MoreHorizontal, Printer, Search, Upload, Users } from "lucide-react";
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
import { Tooltip } from "~/components/ui/IconButton";
import { ShareDialog } from "~/components/sharing/ShareDialog";
import { MoveToDialog } from "~/components/sharing/MoveToDialog";
import { FindReplaceBar } from "./doc/find";
import {
  DEFAULT_TYPOGRAPHY,
  type PageTypography,
} from "~/lib/page-typography";

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
export type BacklinkPage = {
  id: string;
  title: string;
  iconEmoji?: string | null;
};

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
  isTemplate = false,
  typography: initialTypography = null,
  backlinks = [],
  focusMentionUserId,
  aiEnabled = false,
  canManageAccess = false,
  workspaceType,
  workspaceId = null,
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
  // When true, the page is a template (shown in "Start from template" picker).
  isTemplate?: boolean;
  // Per-page display prefs (Aa menu) — null renders defaults.
  typography?: PageTypography | null;
  // When set (arriving from a comment-mention notification), open the comments
  // panel and scroll to this comment.
  focusCommentId?: string;
  // Pages that link TO this page via a @pageMention node.
  backlinks?: BacklinkPage[];
  // When set (arriving from an @-mention notification), scroll to and flash the
  // first mention chip for that user once the collab doc syncs.
  focusMentionUserId?: string;
  // Viewer may manage this document's sharing (open the Share dialog). True for
  // the doc's manager on any workspace type — creator/Core on a lab doc, project
  // staff, the note owner, an instructor, or a Full-access grantee.
  canManageAccess?: boolean;
  // Workspace the page lives in — drives the Share dialog's per-workspace copy
  // (lab-access toggle, base-access line) and the "Move to…" picker's current
  // location.
  workspaceType: string;
  workspaceId?: string | null;
  // True when the server has an AI provider key configured — shows the AI slash items.
  aiEnabled?: boolean;
}) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
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
  const [panelFilter, setPanelFilter] = useState<"open" | "resolved">("open");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // Optimistic local reflection of isTemplate — revalidator syncs server truth.
  const [templateMarked, setTemplateMarked] = useState(isTemplate);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const backlinksRef = useRef<HTMLDivElement | null>(null);
  // Find & replace bar state.
  const [findOpen, setFindOpen] = useState(false);
  const [findInitialQuery, setFindInitialQuery] = useState("");
  // Live editor instance captured via onEditorReady — needed to pass to FindReplaceBar.
  // Using `any` here keeps this file free of BlockNote type imports.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liveEditorRef = useRef<any>(null);
  const [locallyEdited, setLocallyEdited] = useState(false);
  // "Aa" page-typography menu (Notion's Style section): per-page font /
  // small-text / full-width, persisted on Page.typography via the API route.
  // Optimistic local state — the revalidator syncs server truth.
  const [typo, setTypo] = useState<PageTypography>(
    initialTypography ?? DEFAULT_TYPOGRAPHY,
  );
  const [typoOpen, setTypoOpen] = useState(false);
  const typoRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!typoOpen) return;
    const onDown = (e: MouseEvent) => {
      if (typoRef.current && !typoRef.current.contains(e.target as Node)) {
        setTypoOpen(false);
      }
    };
    // globalThis: the React KeyboardEvent type import shadows the DOM one.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setTypoOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [typoOpen]);

  async function saveTypography(next: PageTypography) {
    setTypo(next);
    try {
      await fetch(`/api/pages/${pageId}/typography`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(next),
      });
    } catch {
      // Keep the optimistic value; the next load resyncs from the server.
    }
  }

  // ⌘F / Ctrl-F — open find bar when focus is inside the doc surface.
  // We attach to the document-level keydown so it fires regardless of which
  // child element has focus, but only when the event target is inside the
  // doc surface (bodyRef or its ancestors in this component).
  const docSurfaceRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key !== "f") return;
      // Only intercept when the focused element is inside the doc surface.
      const surface = docSurfaceRef.current;
      if (!surface) return;
      const active = document.activeElement;
      // The doc surface itself, the title, or the editor body.
      if (!surface.contains(active)) return;
      e.preventDefault();
      // Pre-fill with the editor's current text selection if any.
      let selText = "";
      const view = liveEditorRef.current?.prosemirrorView;
      if (view) {
        const { from, to } = view.state.selection;
        if (from !== to) {
          selText = view.state.doc.textBetween(from, to);
        }
      }
      setFindInitialQuery(selText);
      setFindOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

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

  // Comments live in the right-hand rail on a wide container and at the foot of
  // the document otherwise. The top-bar toggle hides both surfaces at once, for
  // readers who want the page without the margin chatter.
  const hasComments = canComment || openThreadCount > 0;
  const [commentsOpen, setCommentsOpen] = useState(true);
  const railVisible = commentsOpen && containerWide && hasComments;

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
    // Both surfaces are always mounted now — the rail when wide, the inline
    // panel at the foot otherwise — so a deep link only has to scroll, not open.
  }, [focusCommentId, containerWide]);

  // Deep-link: ?mention=<userId> — poll for the first mention chip for that
  // user, scroll it into view, and briefly flash it. Mirrors the comment deep-
  // link pattern from DocCommentsRail (up to 40 × 250 ms = 10 s of polling so
  // the collab doc has time to sync before we give up).
  const mentionFocusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusMentionUserId || mentionFocusedRef.current === focusMentionUserId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const attempt = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-mention-id="${CSS.escape(focusMentionUserId)}"]`,
      );
      if (el) {
        mentionFocusedRef.current = focusMentionUserId;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("dali-mention-flash");
        setTimeout(() => el.classList.remove("dali-mention-flash"), 1500);
      } else if (++tries < 40) {
        timer = setTimeout(attempt, 250);
      }
    };
    attempt();
    return () => { if (timer) clearTimeout(timer); };
  }, [focusMentionUserId]);

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

  async function duplicateDoc() {
    setMoreMenuOpen(false);
    const res = await fetch(`/api/pages/${pageId}/duplicate`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return;
    const { id } = (await res.json()) as { id: string };
    navigate(`/documents/${id}`);
  }

  async function toggleTemplate() {
    const next = !templateMarked;
    setTemplateMarked(next);
    setMoreMenuOpen(false);
    await fetch(`/api/pages/${pageId}/template`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isTemplate: next }),
    });
    revalidator.revalidate();
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

  useEffect(() => {
    if (!backlinksOpen) return;
    const onDown = (e: MouseEvent) => {
      if (backlinksRef.current && !backlinksRef.current.contains(e.target as Node)) {
        setBacklinksOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [backlinksOpen]);

  const editedLabel = locallyEdited
    ? "Edited just now"
    : updatedAt
      ? `Edited ${relativeTime(updatedAt)}`
      : null;

  // ── Top bar ───────────────────────────────────────────────────────────────
  const topBar = (
    <div className="doc-topbar flex items-center gap-2 py-2 text-xs text-muted-foreground">
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

      {/* "Aa" page-typography menu — per-page font / small-text / full-width
          (what the Aa glyph promises; selection formatting lives in the
          floating toolbar). Shared prefs: every viewer sees the same doc. */}
      {canEdit && (
        <div ref={typoRef} className="relative">
          <Tooltip label="Page style">
            <button
              type="button"
              onClick={() => setTypoOpen((o) => !o)}
              aria-expanded={typoOpen}
              aria-label="Page typography"
              className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                typoOpen
                  ? "border-accent-coral/40 bg-accent-coral/10 text-accent-coral"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              Aa
            </button>
          </Tooltip>
          {typoOpen && (
            <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-border bg-card p-2 shadow-brand-2 text-sm">
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { key: "default", label: "Default", preview: "font-sans" },
                    { key: "serif", label: "Serif", preview: "font-serif" },
                    { key: "mono", label: "Mono", preview: "font-mono" },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => void saveTypography({ ...typo, font: f.key })}
                    aria-pressed={typo.font === f.key}
                    className={`rounded-md border px-1 py-1.5 text-center transition-colors ${
                      typo.font === f.key
                        ? "border-accent-coral/40 bg-accent-coral/10"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className={`block text-lg leading-none text-foreground ${f.preview}`}>
                      Ag
                    </span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {f.label}
                    </span>
                  </button>
                ))}
              </div>
              <div className="my-2 border-t border-border" />
              <TypographyToggle
                label="Small text"
                checked={typo.smallText}
                onToggle={() =>
                  void saveTypography({ ...typo, smallText: !typo.smallText })
                }
              />
              <TypographyToggle
                label="Full width"
                checked={typo.fullWidth}
                onToggle={() =>
                  void saveTypography({ ...typo, fullWidth: !typo.fullWidth })
                }
              />
              <TypographyToggle
                label="Nesting guides"
                checked={typo.nestingGuides}
                onToggle={() =>
                  void saveTypography({
                    ...typo,
                    nestingGuides: !typo.nestingGuides,
                  })
                }
              />
            </div>
          )}
        </div>
      )}

      {hasComments && (
        <Tooltip label={commentsOpen ? "Hide comments" : "Show comments"}>
          <button
            type="button"
            onClick={() => setCommentsOpen((o) => !o)}
            aria-pressed={commentsOpen}
            aria-label={commentsOpen ? "Hide comments" : "Show comments"}
            className={`inline-flex items-center rounded-md border px-2 py-1 transition-colors ${
              commentsOpen
                ? "border-accent-coral/40 bg-accent-coral/10 text-accent-coral"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      )}

      {/* Share — its own control rather than a ⋯ entry: who can open a document
          is a property of the document, not a rarely-reached utility. */}
      {canManageAccess && (
        <Tooltip label="Share">
          <button
            type="button"
            onClick={() => setAccessOpen(true)}
            aria-label="Share"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Users className="h-3.5 w-3.5" />
            Share
          </button>
        </Tooltip>
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
            <button
              type="button"
              onClick={() => { setFindInitialQuery(""); setFindOpen(true); setMoreMenuOpen(false); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted"
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Find &amp; replace
            </button>
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
              onClick={() => void duplicateDoc()}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted"
            >
              <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Duplicate
            </button>
            {canManageAccess && (
              <button
                type="button"
                onClick={() => {
                  setMoveOpen(true);
                  setMoreMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted"
              >
                <FolderInput className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                Move to…
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => void toggleTemplate()}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted"
              >
                <LayoutTemplate className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {templateMarked ? "Unmark as template" : "Mark as template"}
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
      className="doc-canvas-outer flex justify-center gap-6 pb-12 pt-4 bg-page"
    >
      {/* Paper card — shrinks to make room for the rail when wide */}
      <div
        ref={paperCardRef}
        className={`doc-canvas rounded-xl border border-border bg-card shadow-brand-1 ${
          railVisible
            ? "flex-1 min-w-0"
            : typo.fullWidth
              ? "w-full"
              : "w-full max-w-[1400px]"
        }${typo.font !== "default" ? ` doc-canvas--${typo.font}` : ""}${
          typo.smallText ? " doc-canvas--small" : ""
        }${typo.nestingGuides ? " doc-canvas--guides" : ""}`}
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
                  className="doc-title doc-title-editable min-w-0 flex-1 font-heading text-[40px] font-bold leading-tight text-foreground outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50"
                />
              ) : (
                <h1 className="doc-title min-w-0 flex-1 font-heading text-[40px] font-bold leading-tight text-foreground select-text">
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

            {/* Backlinks affordance — shown only when N > 0 (Notion-style) */}
            {backlinks.length > 0 && (
              <div ref={backlinksRef} className="relative mt-2">
                <button
                  type="button"
                  onClick={() => setBacklinksOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-expanded={backlinksOpen}
                  aria-label={`${backlinks.length} backlink${backlinks.length === 1 ? "" : "s"}`}
                >
                  <Link className="h-3 w-3 shrink-0" />
                  {backlinks.length} backlink{backlinks.length === 1 ? "" : "s"}
                </button>
                {backlinksOpen && (
                  <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-card p-1 shadow-brand-2 text-sm">
                    {backlinks.map((bl) => (
                      <a
                        key={bl.id}
                        href={`/documents/${bl.id}`}
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-foreground hover:bg-muted truncate"
                      >
                        <span className="shrink-0 text-base leading-none">
                          {bl.iconEmoji ?? "📄"}
                        </span>
                        <span className="truncate">{bl.title || "Untitled"}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
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
          <div className="mt-4 relative" ref={bodyRef}>
            {/* Find & replace bar: floats at the top-right of the document area,
                above the editor, below the top bar. Unmounted when closed so
                cleanup decorations fire via the FindReplaceBar unmount effect. */}
            {findOpen && liveEditorRef.current && (
              <FindReplaceBar
                editor={liveEditorRef.current}
                canEdit={canEdit}
                onClose={() => setFindOpen(false)}
                initialQuery={findInitialQuery}
              />
            )}
            {collabToken ? (
              <DocEditor
                features="document"
                editable={canEdit}
                onEditorReady={(ed) => { editorRef.current = ed; liveEditorRef.current = ed; }}
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
                  panelOpen: false,
                  panelTargetId: "doc-comments-dropdown",
                  panelFilter: railVisible ? railFilter : panelFilter,
                  railVisible,
                  railTargetId: RAIL_TARGET_ID,
                  editorContentRef: paperCardRef as RefObject<HTMLElement | null>,
                  onRailFilterChange: setRailFilter,
                  focusCommentId,
                }}
                findOpen={findOpen}
                aiEnabled={aiEnabled}
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

  // Comments at the foot of the document whenever there's no room for the rail.
  const inlineComments = commentsOpen && !containerWide && hasComments && (
    // Centred on the same column as the paper card so the thread list lines up
    // with the text it's about.
    <div className="flex justify-center pb-12">
      <div className={typo.fullWidth ? "w-full" : "w-full max-w-[1400px]"}>
        <DocCommentsPanel
          pageId={pageId}
          currentUserId={currentUserId}
          canComment={canComment}
          canResolve={canResolve}
          open
          onClose={() => {}}
          onFilterChange={setPanelFilter}
          variant="inline"
        />
      </div>
    </div>
  );

  const body = (
    <div ref={docSurfaceRef} className="doc-surface flex flex-col min-h-screen">
      {topBar}
      {canvas}
      {inlineComments}
      {versionHistory}
      {canManageAccess && (
        <ShareDialog
          page={{ id: pageId, title: initialTitle, workspaceType }}
          open={accessOpen}
          onClose={() => setAccessOpen(false)}
          onChanged={() => revalidator.revalidate()}
        />
      )}
      {canManageAccess && (
        <MoveToDialog
          pageId={pageId}
          title={initialTitle}
          current={{ type: workspaceType, id: workspaceId }}
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
          onMoved={() => revalidator.revalidate()}
        />
      )}
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

function TypographyToggle({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-foreground hover:bg-muted"
    >
      <span>{label}</span>
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent-coral" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute left-0 top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
