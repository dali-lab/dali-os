import "@blocknote/shadcn/style.css";
import "~/components/doc/theme.css";
import "./slide-editor.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { MessageSquare } from "lucide-react";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { PageBarMenuItems, PageBarPortal, PageBarTitle, pageBarTextButton } from "~/components/shell/page-bar-slot";
import { PageTitleHeader } from "~/components/doc-chrome/PageTitleHeader";
import { DeckPdfMenuItems } from "./PdfMenuItems";
import { deckPdfUrl } from "~/components/slides/live/urls";
import { Upload } from "lucide-react";
import { Menu } from "~/components/ui/floating";
import { PageBarShareButton } from "~/components/shell/PageBarShareButton";
import { ShareDialog } from "~/components/sharing/ShareDialog";
import { Button } from "~/components/ui/Button";
import { EmptyState } from "~/components/ui/EmptyState";
import { useToast } from "~/components/ui/toast";
import { nameToHexColor } from "~/components/doc/collab-doc";
import { uploadEditorImage, withUploadErrorToast, IMAGE_UPLOAD_ACCEPT } from "~/components/doc/upload";
import { slidesRoomName } from "~/collab/roomName";
import { addFreeImage, setImageSource } from "~/components/slides/deck/freeform-ops";
import {
  addSlide,
  clearSlotImage,
  deleteSlide,
  duplicateSlide,
  moveSlide,
  notesFragment,
  setBuild,
  setBuildBullets,
  setLayout,
  setSlotImage,
  setTextStyle,
  setThemeId,
  undeleteSlide,
} from "~/components/slides/deck/deck-ops";
import { deckUndoExtension } from "~/components/slides/deck/deck-undo";
import { layoutById } from "~/components/slides/deck/layouts";
import { DECK_VERSION } from "~/components/slides/deck/model";
import { appendSlides } from "~/components/slides/pptx/import-apply";
import { DeckDownloadItems, pptxDownloadHref } from "~/components/slides/pptx/DeckDownloadItems";
import { takeImport } from "~/components/slides/pptx/pending-import";
import { usePptxImport } from "~/components/slides/pptx/usePptxImport";
import { EditorToolbar } from "./EditorToolbar";
import { Filmstrip } from "./Filmstrip";
import { Inspector } from "./Inspector";
import { NotesPane } from "./NotesPane";
import { ReadOnlyDeck } from "./ReadOnlyDeck";
import { DeletedSlideNotice, SlideStage, stageKey, type StageComments } from "./SlideStage";
import { SlideCommentsPanel, type CommentTarget } from "./SlideCommentsPanel";
import { pinsForSlide } from "./comment-pins";
import { useSlideComments } from "./useSlideComments";
import { anchorElementId, anchorSlideId, threadCountsBySlide, type SlideThread } from "~/lib/slide-comments";
import type { SlotCollab } from "./SlotEditor";
import type { SlidesEditorProps } from "./SlidesEditor";
import { useFreeformEditor } from "./useFreeformEditor";
import { useDeckDoc, useDeckSnapshot, useDeckSync, useSlidePresence, useUndoState } from "./useDeckDoc";

function naturalSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const SYNC_LABEL = { saved: "Saved", saving: "Saving", offline: "Offline, changes will sync" } as const;

function usePageSaver(pageId: string) {
  const revalidator = useRevalidator();
  return useCallback(
    async (patch: { title?: string; iconEmoji?: string | null }) => {
      await fetch(`/api/documents/${pageId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      revalidator.revalidate();
    },
    [pageId, revalidator],
  );
}

function SlidesEditorBody({ pageId, title, iconEmoji, canEdit, canComment, canModerateComments, canManageAccess, workspaceType, collab, link, actionsSlot }: SlidesEditorProps) {
  const toast = useToast();
  const revalidator = useRevalidator();
  const savePage = usePageSaver(pageId);
  const [emoji, setEmoji] = useState(iconEmoji);
  const [shareOpen, setShareOpen] = useState(false);
  const deck = useDeckDoc(pageId, collab.token);
  const snap = useDeckSnapshot(deck);
  const { state: syncState, synced } = useDeckSync(deck);
  const { canUndo, canRedo } = useUndoState(deck?.undo ?? null);
  const me = useMemo(
    () => ({ userId: collab.userId, name: collab.userName, color: nameToHexColor(collab.userName), photoUrl: collab.photoUrl }),
    [collab.userId, collab.userName, collab.photoUrl],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = snap.slides.find((s) => s.id === selectedId) ?? null;
  const deletedHere = selectedId !== null && !current && snap.deletedIds.includes(selectedId);
  const known = snap.v === undefined ? null : snap.v === DECK_VERSION;
  const editable = canEdit && known === true;

  const freeform = useFreeformEditor({ deck, slide: current, editable });

  useEffect(() => {
    if (deletedHere || current || snap.slides.length === 0) return;
    setSelectedId(snap.slides[0].id);
  }, [current, deletedHere, snap.slides]);

  const slideComments = useSlideComments(pageId, canComment);
  const [commentsOpen, setCommentsOpen] = useState(Boolean(link?.threadId));
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null);
  const [focusThreadId, setFocusThreadId] = useState<string | null>(link?.threadId ?? null);
  const linkApplied = useRef(false);
  useEffect(() => {
    if (linkApplied.current || known === null || snap.slides.length === 0 || !link?.slideId) return;
    linkApplied.current = true;
    const exists = snap.slides.some((s) => s.id === link.slideId) || snap.deletedIds.includes(link.slideId);
    if (!exists) return;
    setSelectedId(link.slideId);
  }, [known, link?.slideId, snap.slides, snap.deletedIds]);

  const startComment = (target: CommentTarget) => {
    setSelectedId(target.slideId);
    setCommentTarget(target);
    setCommentsOpen(true);
  };
  const openThread = (thread: SlideThread) => {
    const slideId = anchorSlideId(thread.root.anchor);
    if (slideId) setSelectedId(slideId);
    const elementId = thread.kind === "text" ? anchorElementId(thread.root.anchor) : null;
    freeform.setSelection(elementId ? [elementId] : []);
    setFocusThreadId(thread.root.id);
  };
  const stageComments: StageComments | undefined =
    canComment && current
      ? {
          pageId,
          viewerId: collab.userId,
          canComment,
          canModerate: canModerateComments,
          pins: pinsForSlide(slideComments.comments, current.id, current.layoutId, current),
          focusedPinId: focusThreadId,
          onOpenPin: (id) => (setFocusThreadId(id), setCommentsOpen(true)),
          onStart: startComment,
        }
      : undefined;
  const commentsPanel = canComment && commentsOpen && (
    <SlideCommentsPanel
      comments={slideComments.comments}
      error={slideComments.error}
      viewerId={collab.userId}
      canComment={canComment}
      canModerate={canModerateComments}
      slideIds={snap.slides.map((s) => s.id)}
      deletedIds={snap.deletedIds}
      currentSlideId={current?.id ?? null}
      canRestore={editable}
      target={commentTarget}
      focusThreadId={focusThreadId}
      onClearTarget={() => setCommentTarget(null)}
      onPost={slideComments.post}
      onDelete={(id) => void slideComments.remove(id)}
      onOpenThread={openThread}
      onRestoreSlide={(id) => deck && undeleteSlide(deck.doc, id)}
      onClose={() => setCommentsOpen(false)}
    />
  );

  useEffect(() => {
    deck?.undo.setCurrentSlide(selectedId);
  }, [deck, selectedId]);
  useEffect(() => {
    if (!deck) return;
    deck.undo.setNavigator((id) => setSelectedId(id));
    return () => deck.undo.setNavigator(null);
  }, [deck]);

  const peers = useSlidePresence(deck, me, editable ? selectedId : null);

  const slotCollab = useMemo<SlotCollab | null>(
    () =>
      deck
        ? { room: slidesRoomName(pageId), token: collab.token, user: me, undoExtension: deckUndoExtension(deck.undo.manager) }
        : null,
    [deck, pageId, collab.token, me],
  );

  const select = (id: string) => setSelectedId(id);
  const undo = () => deck?.undo.manager.undo();
  const redo = () => deck?.undo.manager.redo();

  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[contenteditable='true'], input, textarea")) return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "z") (e.preventDefault(), e.shiftKey ? redo() : undo());
      else if (k === "y") (e.preventDefault(), redo());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const add = (layoutId: string) => {
    if (deck) select(addSlide(deck.doc, layoutId, selectedId));
  };
  const duplicate = (id: string) => {
    const copy = deck && duplicateSlide(deck.doc, id);
    if (copy) select(copy);
  };
  const remove = (id: string) => {
    if (!deck) return;
    const i = snap.slides.findIndex((s) => s.id === id);
    const next = snap.slides[i + 1] ?? snap.slides[i - 1] ?? null;
    deleteSlide(deck.doc, id, me.name);
    if (id === selectedId) select(next?.id ?? "");
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<{ type: "slot" } | { type: "free" } | { type: "replace"; id: string }>({ type: "slot" });
  const hasImageSlot = current ? layoutById(current.layoutId).slots.some((s) => s.kind === "image") : false;
  const openPicker = (target: typeof pickTarget.current) => {
    pickTarget.current = target;
    fileRef.current?.click();
  };
  const pickImage = (elementId?: string) => {
    if (!current) return;
    const free = elementId ? current.elements.find((e) => e.id === elementId && e.slot === null) : undefined;
    if (free) return openPicker({ type: "replace", id: free.id });
    if (!hasImageSlot) {
      toast.info("This layout has no image. Choose Text and image or Image in the Slide tab.");
      return;
    }
    openPicker({ type: "slot" });
  };
  const upload = useMemo(() => withUploadErrorToast((file) => uploadEditorImage(file, toast.info), toast.error), [toast]);
  const onFile = async (file: File | undefined) => {
    if (!file || !deck || !current) return;
    const target = pickTarget.current;
    const slideId = current.id;
    try {
      const url = await upload(file);
      const alt = file.name.replace(/\.[^.]*$/, "");
      if (target.type === "slot") setSlotImage(deck.doc, slideId, url, alt);
      else if (target.type === "replace") deck.undo.step(() => setImageSource(deck.doc, slideId, target.id, url, alt));
      else {
        const natural = await naturalSize(url);
        const id = deck.undo.step(() => addFreeImage(deck.doc, slideId, url, alt, natural));
        if (id) freeform.setSelection([id]);
      }
    } catch {
      return;
    }
  };

  const appendImported = useCallback((slides: Parameters<typeof appendSlides>[1]) => (deck ? appendSlides(deck.doc, slides) : []), [deck]);
  const pptx = usePptxImport(appendImported, ({ firstId }) => firstId && select(firstId));
  const { importPrepared } = pptx;
  useEffect(() => {
    if (!deck || !synced || !editable) return;
    const pending = takeImport(pageId);
    if (pending) void importPrepared(pending.slides, pending.skipped);
  }, [deck, synced, editable, pageId, importPrepared]);

  const pageBar = (
    <>
      <PageBarTitle
        title={title}
        onRename={editable ? (name) => savePage({ title: name }) : undefined}
        emoji={emoji}
      />
      <PageTitleHeader
        className="px-4 pt-4 pb-3"
        title={title}
        iconEmoji={emoji ?? null}
        canEdit={editable}
        onRename={(name) => savePage({ title: name })}
        onIconChange={(next) => (setEmoji(next), void savePage({ iconEmoji: next }))}
      />
      <DeckPdfMenuItems pageId={pageId} canExportNotes={canEdit} />
      <DeckDownloadItems pageId={pageId} />
      {editable && (
        <PageBarMenuItems>
          <Menu.Item icon={<Upload className="h-3.5 w-3.5" />} disabled={pptx.busy} onSelect={pptx.pick}>
            Import slides
          </Menu.Item>
        </PageBarMenuItems>
      )}
      <PageBarPortal slot="status">
        <div className="flex items-center gap-1 text-[13px] text-os-muted" aria-live="polite">
          {SYNC_LABEL[syncState]}
        </div>
      </PageBarPortal>
      <PageBarPortal slot="presence">
        <PresenceBar />
      </PageBarPortal>
      <PageBarPortal slot="actions">
        {canComment && (
          <button
            type="button"
            onClick={() => setCommentsOpen((o) => !o)}
            aria-pressed={commentsOpen}
            aria-label={commentsOpen ? "Hide comments" : "Show comments"}
            className={pageBarTextButton(commentsOpen)}
          >
            <MessageSquare className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Comments</span>
          </button>
        )}
        {canManageAccess && <PageBarShareButton onClick={() => setShareOpen(true)} />}
        {typeof actionsSlot === "function" ? actionsSlot({ currentSlideId: current?.id ?? null }) : actionsSlot}
      </PageBarPortal>
      {canManageAccess && (
        <ShareDialog page={{ id: pageId, title, workspaceType }} open={shareOpen} onClose={() => setShareOpen(false)} onChanged={() => revalidator.revalidate()} />
      )}
    </>
  );

  if (!deck || known === null) {
    return (
      <>
        {pageBar}
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">Loading deck…</div>
      </>
    );
  }

  if (!editable) {
    return (
      <>
        {pageBar}
        <div className="flex min-h-0 flex-1">
          <ReadOnlyDeck
            slides={snap.slides}
            themeId={snap.themeId}
            notice={known === false ? "This deck was made with a newer version of Slides, so you can view it but not edit it." : undefined}
            currentId={current?.id ?? null}
            onSelect={select}
            comments={stageComments}
          />
          {commentsPanel}
        </div>
      </>
    );
  }

  const notes = current ? notesFragment(deck.doc, current.id) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-os-card bg-os-card">
      {pageBar}
      <EditorToolbar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} onAdd={add} onImage={() => openPicker({ type: "free" })} armed={freeform.armed} onArm={freeform.arm} />
      <div className="flex min-h-0 flex-1">
        <Filmstrip
          slides={snap.slides}
          themeId={snap.themeId}
          currentId={current?.id ?? null}
          peers={peers}
          editable
          commentCounts={canComment ? threadCountsBySlide(slideComments.comments) : undefined}
          onComment={canComment ? (id) => startComment({ slideId: id }) : undefined}
          onSelect={select}
          onAdd={add}
          onDuplicate={duplicate}
          onDelete={remove}
          onMove={(id, index) => moveSlide(deck.doc, id, index)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col p-4">
            {current && slotCollab ? (
              <SlideStage
                key={stageKey(snap.epoch, current.id)}
                slide={current}
                themeId={snap.themeId}
                doc={deck.doc}
                collab={slotCollab}
                editable
                freeform={freeform.stage}
                onPickImage={pickImage}
                comments={stageComments}
              />
            ) : deletedHere ? (
              <DeletedSlideNotice by={snap.deletedBy[selectedId!] ?? null} onRestore={() => undeleteSlide(deck.doc, selectedId!)} />
            ) : (
              <EmptyState actions={<Button size="sm" onClick={() => add("title")}>New slide</Button>}>This deck doesn't have any slides yet.</EmptyState>
            )}
          </div>
          {current && notes && slotCollab && <NotesPane key={stageKey(snap.epoch, current.id)} fragment={notes} collab={slotCollab} />}
        </div>
        <Inspector
          slide={current}
          themeId={snap.themeId}
          slideCount={snap.slides.length}
          selection={freeform.selection}
          freeform={freeform.inspector}
          editable
          onLayout={(id) => current && setLayout(deck.doc, current.id, id)}
          onTheme={(id) => setThemeId(deck.doc, id)}
          onTextStyle={(slot, style) => current && setTextStyle(deck.doc, current.id, slot, style)}
          onPickImage={() => pickImage()}
          onClearImage={() => current && clearSlotImage(deck.doc, current.id)}
          onBuild={(slot, build) => current && setBuild(deck.doc, current.id, slot, build)}
          onBuildBullets={(slot, on) => current && setBuildBullets(deck.doc, current.id, slot, on)}
          onDownloadPdf={(withNotes) => window.location.assign(deckPdfUrl(pageId, withNotes))}
          onImport={pptx.pick}
          importing={pptx.busy}
          downloadHref={pptxDownloadHref(pageId)}
        />
        {commentsPanel}
      </div>
      <input {...pptx.inputProps} />
      <input ref={fileRef} type="file" accept={IMAGE_UPLOAD_ACCEPT} hidden onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ""))} />
    </div>
  );
}

export default function SlidesEditorImpl(props: SlidesEditorProps) {
  return (
    <PresenceProvider
      pageId={`doc:${props.pageId}`}
      token={props.collab.token}
      userName={props.collab.userName}
      userId={props.collab.userId}
      photoUrl={props.collab.photoUrl}
    >
      <SlidesEditorBody {...props} />
    </PresenceProvider>
  );
}
