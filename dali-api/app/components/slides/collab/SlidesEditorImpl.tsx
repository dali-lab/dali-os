import "@blocknote/shadcn/style.css";
import "~/components/doc/theme.css";
import "./slide-editor.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { BookmarkPlus, Keyboard, MessageSquare, Search } from "lucide-react";
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
import { SaveTemplateModal } from "~/components/slides/templates/SaveTemplateModal";
import { fetchTemplate, removeTemplate, saveTemplate, type TemplateRow } from "~/components/slides/templates/templates-client";
import { useTemplates } from "~/components/slides/templates/useTemplates";
import { nameToHexColor } from "~/components/doc/collab-doc";
import { uploadEditorImage, withUploadErrorToast, IMAGE_UPLOAD_ACCEPT } from "~/components/doc/upload";
import { slidesRoomName } from "~/collab/roomName";
import { addFreeImage, setImageSource } from "~/components/slides/deck/freeform-ops";
import { pasteSlides, parseSlideClipboard, sanitizeClips, serializeSlides, slidesToClips } from "~/components/slides/deck/slide-clipboard";
import { STAGE_H, STAGE_W } from "~/components/slides/deck/layouts";
import {
  addSlide,
  clearSlotImage,
  deleteSlide,
  duplicateSlide,
  moveSlides,
  notesFragment,
  setBuild,
  setBuildBullets,
  setLayout,
  setSlideSkipped,
  setSlotImage,
  setTextStyle,
  setThemeId,
  undeleteSlide,
} from "~/components/slides/deck/deck-ops";
import { deckUndoExtension } from "~/components/slides/deck/deck-undo";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { layoutById } from "~/components/slides/deck/layouts";
import { DECK_VERSION } from "~/components/slides/deck/model";
import { appendSlides } from "~/components/slides/pptx/import-apply";
import { DeckDownloadItems, pptxDownloadHref } from "~/components/slides/pptx/DeckDownloadItems";
import { takeImport } from "~/components/slides/pptx/pending-import";
import { usePptxImport } from "~/components/slides/pptx/usePptxImport";
import { EditorToolbar } from "./EditorToolbar";
import { thumbnailActions } from "./actions";
import { planDrop } from "./drop-images";
import { actingSet, dropIndex, nextThumbSelection, type ThumbSelection } from "./filmstrip-select";
import { Filmstrip } from "./Filmstrip";
import { zoomIn, zoomKey, zoomOut } from "./zoom";
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
import { canReadClip, readClip, useFreeformEditor, writeClip, type FreeformExternal } from "./useFreeformEditor";
import { useInsertItems } from "./useInsertItems";
import { GridView } from "./GridView";
import { LayoutGalleryModal } from "./LayoutPicker";
import { SectionNameModal } from "./SectionNameModal";
import { TransitionPreview } from "./TransitionPreview";
import { sectionActions } from "./actions";
import { moveSection, setSectionStart, setSlideBackground, setSlideTransition } from "~/components/slides/deck/deck-ops";
import { sectionsOf } from "~/components/slides/deck/slide-meta";
import { FindBar } from "./FindBar";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { shortcutFor } from "./shortcuts";
import { useDeckFind } from "./useDeckFind";
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

  const externalRef = useRef<FreeformExternal>({});
  const external = useMemo<FreeformExternal>(
    () => ({
      pickReplace: (id) => externalRef.current.pickReplace?.(id),
      pickAt: (at) => externalRef.current.pickAt?.(at),
      insertAt: (item, at) => externalRef.current.insertAt?.(item, at),
      addImages: (files, at) => externalRef.current.addImages?.(files, at),
      comment: (target) => externalRef.current.comment?.(target),
      changeLayout: (id) => externalRef.current.changeLayout?.(id),
    }),
    [],
  );
  const freeform = useFreeformEditor({ deck, slide: current, editable, external });
  const [zoom, setZoom] = useState(1);
  const [thumbSel, setThumbSel] = useState<ThumbSelection>({ selected: [], anchor: null });

  const undone = deletedHere && selectedId !== null && !snap.deletedBy[selectedId];
  useEffect(() => {
    if ((deletedHere && !undone) || current || snap.slides.length === 0) return;
    setSelectedId(snap.slides[0].id);
  }, [current, deletedHere, undone, snap.slides]);

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

  const [helpOpen, setHelpOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [gallery, setGallery] = useState<{ ids: string[] } | null>(null);
  const [sectionModal, setSectionModal] = useState<{ slideId: string; initial: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[contenteditable='true'], input, textarea")) return;
      const id = shortcutFor(e);
      if (id === "undo") (e.preventDefault(), undo());
      else if (id === "redo") (e.preventDefault(), redo());
      else if (id === "help") (e.preventDefault(), setHelpOpen(true));
      else if (id === "grid") (e.preventDefault(), setGridOpen((g) => !g));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      const k = zoomKey(e);
      if (!k) return;
      e.preventDefault();
      setZoom((z) => (k === "in" ? zoomIn(z) : k === "out" ? zoomOut(z) : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable]);

  const add = (layoutId: string) => {
    if (deck) select(deck.undo.step(() => addSlide(deck.doc, layoutId, selectedId)));
  };
  const duplicate = (id: string) => {
    const copy = deck && deck.undo.step(() => duplicateSlide(deck.doc, id));
    if (copy) select(copy);
  };
  const remove = (id: string) => {
    if (!deck) return;
    const i = snap.slides.findIndex((s) => s.id === id);
    const next = snap.slides[i + 1] ?? snap.slides[i - 1] ?? null;
    deleteSlide(deck.doc, id, me.name);
    if (id === selectedId) select(next?.id ?? "");
  };

  const library = useTemplates(pageId, canEdit);
  const [saving, setSaving] = useState<{ kind: "Deck" | "Slide"; slides: RenderSlide[] } | null>(null);
  const saveToLibrary = async (title: string, scope: "lab" | "project") => {
    if (!saving) return null;
    const result = await saveTemplate({ kind: saving.kind, title, pageId, scope, themeId: snap.themeId, slides: slidesToClips(saving.slides) });
    if (!result.ok) return result.error;
    toast.success(saving.kind === "Deck" ? "Saved as a template" : "Saved to the library");
    setSaving(null);
    void library.refresh();
    return null;
  };
  const insertFromLibrary = async (row: TemplateRow) => {
    const template = await fetchTemplate(row.id);
    const clips = template && sanitizeClips(template.slides);
    if (!deck || !clips) return void toast.error("Couldn't open that template.");
    const created = deck.undo.step(() => pasteSlides(deck.doc, clips, selectedId));
    if (created[0]) select(created[0]);
  };
  const deleteFromLibrary = async (row: TemplateRow) => {
    if (await removeTemplate(row.id)) void library.refresh();
    else toast.error("Couldn't delete that template.");
  };
  const slideLibrary = canEdit ? { templates: library.templates, loaded: library.loaded, onPick: insertFromLibrary, onDelete: deleteFromLibrary } : undefined;

  const order = useMemo(() => snap.slides.map((s) => s.id), [snap.slides]);
  const onThumbSelect = (id: string, mods: { shift: boolean; meta: boolean }) => {
    setThumbSel((prev) => nextThumbSelection(order, prev, id, mods));
    select(id);
  };
  const thumbnailMenu = (id: string) => {
    if (!deck) return [];
    const ids = actingSet(order, thumbSel.selected, id);
    const targets = snap.slides.filter((s) => ids.includes(s.id));
    const last = ids[ids.length - 1];
    const step = <T,>(fn: () => T): T => deck.undo.step(fn);
    return thumbnailActions({
      targets,
      index: order.indexOf(id),
      count: order.length,
      canPaste: canReadClip(),
      canComment,
      startsSection: Boolean(snap.slides.find((x) => x.id === id)?.section),
      handlers: {
        newAfter: () => select(step(() => addSlide(deck.doc, "content", last))),
        duplicate: () => {
          let copy: string | null = null;
          step(() => ids.forEach((sid) => (copy = duplicateSlide(deck.doc, sid) ?? copy)));
          if (copy) select(copy);
        },
        remove: () => {
          const i = order.indexOf(ids[0]);
          const next = snap.slides.find((s, j) => j > i && !ids.includes(s.id)) ?? [...snap.slides].reverse().find((s) => !ids.includes(s.id)) ?? null;
          step(() => ids.forEach((sid) => deleteSlide(deck.doc, sid, me.name)));
          setThumbSel({ selected: [], anchor: null });
          if (ids.includes(selectedId ?? "")) select(next?.id ?? "");
        },
        skip: (skipped) => step(() => setSlideSkipped(deck.doc, ids, skipped)),
        changeLayout: (layoutId) => step(() => ids.forEach((sid) => setLayout(deck.doc, sid, layoutId))),
        openLayoutGallery: () => setGallery({ ids }),
        addSection: () => setSectionModal({ slideId: id, initial: "" }),
        renameSection: () => setSectionModal({ slideId: id, initial: snap.slides.find((x) => x.id === id)?.section ?? "" }),
        removeSection: () => step(() => setSectionStart(deck.doc, id, null)),
        copy: () => {
          const text = serializeSlides(targets);
          if (text) void writeClip(text);
        },
        paste: () => {
          void readClip().then((text) => {
            const clips = parseSlideClipboard(text);
            if (!clips) return;
            const created = step(() => pasteSlides(deck.doc, clips, last));
            if (created[0]) select(created[0]);
          });
        },
        moveTo: (where) => step(() => moveSlides(deck.doc, ids, where === "top" ? 0 : order.length)),
        comment: () => startComment({ slideId: id }),
        saveToLibrary: () => setSaving({ kind: "Slide", slides: targets }),
      },
    });
  };
  const onMoveSlides = (activeId: string, overId: string) => {
    if (!deck) return;
    const ids = actingSet(order, thumbSel.selected, activeId);
    const to = dropIndex(order, ids, overId);
    if (to !== null) deck.undo.step(() => moveSlides(deck.doc, ids, to));
  };

  const sectionMenu = (firstId: string) => {
    if (!deck) return [];
    const { sections } = sectionsOf(snap.slides);
    const at = sections.findIndex((x) => x.firstId === firstId);
    const section = sections[at];
    if (!section) return [];
    const others = order.filter((sid) => !section.slideIds.includes(sid));
    const before = sections[at - 1];
    const after = sections[at + 1];
    return sectionActions(
      {
        rename: () => setSectionModal({ slideId: firstId, initial: section.name }),
        remove: () => deck.undo.step(() => setSectionStart(deck.doc, firstId, null)),
        moveUp: () => before && deck.undo.step(() => moveSection(deck.doc, firstId, others.indexOf(before.firstId))),
        moveDown: () => after && deck.undo.step(() => moveSection(deck.doc, firstId, others.indexOf(after.slideIds[after.slideIds.length - 1]) + 1)),
      },
      { first: at === 0, last: at === sections.length - 1 },
    );
  };

  const fileRef = useRef<HTMLInputElement>(null);
  type PickTarget = { type: "slot" } | { type: "background" } | { type: "free"; at?: { x: number; y: number } } | { type: "replace"; id: string };
  const pickTarget = useRef<PickTarget>({ type: "slot" });
  const hasImageSlot = current ? layoutById(current.layoutId).slots.some((s) => s.kind === "image") : false;
  const openPicker = (target: PickTarget) => {
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
  const { insertItem, pickers } = useInsertItems({ insert: freeform.insert, arm: freeform.arm, pickImage: (at) => openPicker({ type: "free", ...(at ? { at } : {}) }) });
  const upload = useMemo(() => withUploadErrorToast((file) => uploadEditorImage(file, toast.info), toast.error), [toast]);
  const placeFile = async (file: File, target: PickTarget, slideId: string) => {
    if (!deck) return;
    try {
      const url = await upload(file);
      const alt = file.name.replace(/\.[^.]*$/, "");
      if (target.type === "background") deck.undo.step(() => setSlideBackground(deck.doc, [slideId], { kind: "image", url, fit: "cover" }));
      else if (target.type === "slot") setSlotImage(deck.doc, slideId, url, alt);
      else if (target.type === "replace") deck.undo.step(() => setImageSource(deck.doc, slideId, target.id, url, alt));
      else {
        const natural = await naturalSize(url);
        const id = deck.undo.step(() => addFreeImage(deck.doc, slideId, url, alt, natural, target.at));
        if (id) freeform.setSelection([id]);
      }
    } catch {
      return;
    }
  };
  const onFile = async (file: File | undefined) => {
    if (!file || !deck || !current) return;
    await placeFile(file, pickTarget.current, current.id);
  };
  const addImages = async (files: File[], at: { x: number; y: number } | null) => {
    if (!deck || !current) return;
    const slideId = current.id;
    for (const plan of planDrop(current, files, at ?? { x: STAGE_W / 2, y: STAGE_H / 2 })) {
      await placeFile(plan.file, plan.replaceId ? { type: "replace", id: plan.replaceId } : { type: "free", at: plan.at }, slideId);
    }
  };
  externalRef.current = {
    pickReplace: (id) => openPicker({ type: "replace", id }),
    pickAt: (at) => openPicker({ type: "free", ...(at ? { at } : {}) }),
    insertAt: insertItem,
    addImages: (files, at) => void addImages(files, at),
    comment: startComment,
    changeLayout: (layoutId) => current && deck && deck.undo.step(() => setLayout(deck.doc, current.id, layoutId)),
    openLayoutGallery: () => current && setGallery({ ids: [current.id] }),
    setBackground: (background) => current && deck && deck.undo.step(() => setSlideBackground(deck.doc, [current.id], background)),
    pickBackgroundImage: () => openPicker({ type: "background" }),
  };

  const appendImported = useCallback((slides: Parameters<typeof appendSlides>[1]) => (deck ? appendSlides(deck.doc, slides) : []), [deck]);
  const pptx = usePptxImport(appendImported, ({ firstId }) => firstId && select(firstId));
  const { importPrepared } = pptx;
  useEffect(() => {
    if (!deck || !synced || !editable) return;
    const pending = takeImport(pageId);
    if (pending) void importPrepared(pending.slides, pending.skipped);
  }, [deck, synced, editable, pageId, importPrepared]);

  const pendingReveal = useRef<{ slideId: string; key: string | null } | null>(null);
  const find = useDeckFind({
    deck,
    snap,
    editable,
    onReveal: (slideId, key) => {
      if (slideId === current?.id) freeform.setSelection(key ? [key] : []);
      else {
        pendingReveal.current = { slideId, key };
        select(slideId);
      }
    },
  });
  useEffect(() => {
    const pending = pendingReveal.current;
    if (!pending || current?.id !== pending.slideId) return;
    pendingReveal.current = null;
    freeform.setSelection(pending.key ? [pending.key] : []);
  }, [current?.id, freeform.setSelection]);

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
          <Menu.Item icon={<BookmarkPlus className="h-3.5 w-3.5" />} disabled={snap.slides.length === 0} onSelect={() => setSaving({ kind: "Deck", slides: snap.slides })}>
            Save as template
          </Menu.Item>
          <Menu.Item icon={<Search className="h-3.5 w-3.5" />} onSelect={() => find.show()}>
            Find and replace
          </Menu.Item>
          <Menu.Item icon={<Keyboard className="h-3.5 w-3.5" />} onSelect={() => setHelpOpen(true)}>
            Keyboard shortcuts
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
      <EditorToolbar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} onAdd={add} onInsert={insertItem} library={slideLibrary} armed={freeform.armed} themeId={snap.themeId} currentLayoutId={current?.layoutId ?? null} grid={gridOpen} onGrid={() => setGridOpen((g) => !g)} />
      <div className="flex min-h-0 flex-1">
        <Filmstrip
          slides={snap.slides}
          themeId={snap.themeId}
          currentId={current?.id ?? null}
          selectedIds={thumbSel.selected}
          peers={peers}
          editable
          commentCounts={canComment ? threadCountsBySlide(slideComments.comments) : undefined}
          actionsFor={thumbnailMenu}
          sectionActionsFor={sectionMenu}
          currentLayoutId={current?.layoutId ?? null}
          onSelect={onThumbSelect}
          onAdd={add}
          library={slideLibrary}
          onDuplicate={duplicate}
          onDelete={remove}
          onMove={onMoveSlides}
        />
        <div className="relative flex min-w-0 flex-1 flex-col">
          {find.open && <FindBar find={find} />}
          {gridOpen ? (
            <GridView
              slides={snap.slides}
              themeId={snap.themeId}
              currentId={current?.id ?? null}
              selectedIds={thumbSel.selected}
              editable
              actionsFor={thumbnailMenu}
              onSelect={onThumbSelect}
              onMove={onMoveSlides}
              onOpen={(sid) => (select(sid), setGridOpen(false))}
            />
          ) : (
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
                zoom={zoom}
                onZoom={setZoom}
              />
            ) : deletedHere ? (
              <DeletedSlideNotice by={snap.deletedBy[selectedId!] ?? null} onRestore={() => undeleteSlide(deck.doc, selectedId!)} />
            ) : (
              <EmptyState actions={<Button size="sm" onClick={() => add("title")}>New slide</Button>}>This deck doesn't have any slides yet.</EmptyState>
            )}
          </div>
          )}
          {!gridOpen && current && notes && slotCollab && <NotesPane key={stageKey(snap.epoch, current.id)} fragment={notes} collab={slotCollab} />}
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
          onBackground={(background) => current && deck.undo.step(() => setSlideBackground(deck.doc, [current.id], background))}
          onPickBackground={() => openPicker({ type: "background" })}
          onTransition={(transition) => current && deck.undo.step(() => setSlideTransition(deck.doc, [current.id], transition))}
          onPreviewTransition={() => setPreviewOpen(true)}
        />
        {commentsPanel}
      </div>
      {pickers}
      {gallery && (
        <LayoutGalleryModal
          title="Choose a layout"
          themeId={snap.themeId}
          value={gallery.ids.length === 1 ? snap.slides.find((x) => x.id === gallery.ids[0])?.layoutId : undefined}
          onClose={() => setGallery(null)}
          onPick={(layoutId) => {
            const ids = gallery.ids;
            deck.undo.step(() => ids.forEach((sid) => setLayout(deck.doc, sid, layoutId)));
            setGallery(null);
          }}
        />
      )}
      {sectionModal && (
        <SectionNameModal
          title={sectionModal.initial ? "Rename section" : "Add section"}
          initial={sectionModal.initial}
          confirmLabel={sectionModal.initial ? "Rename" : "Add section"}
          onClose={() => setSectionModal(null)}
          onSubmit={(name) => {
            const target = sectionModal.slideId;
            deck.undo.step(() => setSectionStart(deck.doc, target, name));
            setSectionModal(null);
          }}
        />
      )}
      {previewOpen && current && (
        <TransitionPreview previous={snap.slides[snap.slides.findIndex((x) => x.id === current.id) - 1] ?? null} slide={current} themeId={snap.themeId} onClose={() => setPreviewOpen(false)} />
      )}
      {saving && (
        <SaveTemplateModal
          open
          kind={saving.kind}
          slideCount={saving.slides.length}
          defaultTitle={saving.kind === "Deck" ? title : saving.slides.length === 1 ? "Untitled slide" : "Saved slides"}
          canSaveToProject={library.canSaveToProject}
          onSave={saveToLibrary}
          onClose={() => setSaving(null)}
        />
      )}
      <ShortcutsSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
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
