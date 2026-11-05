import "@blocknote/shadcn/style.css";
import "~/components/doc/theme.css";
import "./slide-editor.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { PageBarPortal, PageBarTitle } from "~/components/shell/page-bar-slot";
import { PageBarShareButton } from "~/components/shell/PageBarShareButton";
import { ShareDialog } from "~/components/sharing/ShareDialog";
import { Button } from "~/components/ui/Button";
import { EmptyState } from "~/components/ui/EmptyState";
import { useToast } from "~/components/ui/toast";
import { nameToHexColor } from "~/components/doc/collab-doc";
import { uploadEditorImage, withUploadErrorToast, IMAGE_UPLOAD_ACCEPT } from "~/components/doc/upload";
import { slidesRoomName } from "~/collab/roomName";
import {
  addSlide,
  clearSlotImage,
  deleteSlide,
  duplicateSlide,
  ensureSlotsOn,
  moveSlide,
  notesFragment,
  setLayout,
  setSlotImage,
  setTextStyle,
  setThemeId,
  undeleteSlide,
} from "~/components/slides/deck/deck-ops";
import { deckUndoExtension } from "~/components/slides/deck/deck-undo";
import { layoutById } from "~/components/slides/deck/layouts";
import { DECK_VERSION } from "~/components/slides/deck/model";
import { EditorToolbar } from "./EditorToolbar";
import { Filmstrip } from "./Filmstrip";
import { Inspector } from "./Inspector";
import { NotesPane } from "./NotesPane";
import { ReadOnlyDeck } from "./ReadOnlyDeck";
import { DeletedSlideNotice, SlideStage } from "./SlideStage";
import type { SlotCollab } from "./SlotEditor";
import type { SlidesEditorProps } from "./SlidesEditor";
import { useDeckDoc, useDeckSnapshot, useDeckSync, useSlidePresence, useUndoState } from "./useDeckDoc";

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

export default function SlidesEditorImpl({ pageId, title, iconEmoji, canManageAccess, workspaceType, collab, actionsSlot }: SlidesEditorProps) {
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
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const current = snap.slides.find((s) => s.id === selectedId) ?? null;
  const deletedHere = selectedId !== null && !current && snap.deletedIds.includes(selectedId);
  const known = snap.v === undefined ? null : snap.v === DECK_VERSION;
  const editable = known === true;

  useEffect(() => {
    if (deletedHere || current || snap.slides.length === 0) return;
    setSelectedId(snap.slides[0].id);
  }, [current, deletedHere, snap.slides]);

  useEffect(() => {
    if (deck && current && editable && synced) ensureSlotsOn(deck.doc, current.id);
  }, [deck, current?.id, current?.layoutId, editable, synced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    deck?.undo.setCurrentSlide(selectedId);
  }, [deck, selectedId]);
  useEffect(() => {
    if (!deck) return;
    deck.undo.setNavigator((id) => {
      setSelectedId(id);
      setSelectedSlot(null);
    });
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

  const select = (id: string) => {
    setSelectedId(id);
    setSelectedSlot(null);
  };
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
  const hasImageSlot = current ? layoutById(current.layoutId).slots.some((s) => s.kind === "image") : false;
  const pickImage = () => {
    if (!current) return;
    if (!hasImageSlot) {
      toast.info("This layout has no image. Choose Text and image or Image in the Slide tab.");
      return;
    }
    fileRef.current?.click();
  };
  const upload = useMemo(() => withUploadErrorToast((file) => uploadEditorImage(file, toast.info), toast.error), [toast]);
  const onFile = async (file: File | undefined) => {
    if (!file || !deck || !current) return;
    try {
      const url = await upload(file);
      setSlotImage(deck.doc, current.id, url, file.name.replace(/\.[^.]*$/, ""));
    } catch {
      return;
    }
  };

  const pageBar = (
    <>
      <PageBarTitle
        title={title}
        onRename={editable ? (name) => savePage({ title: name }) : undefined}
        emoji={emoji}
        onEmojiChange={editable ? (next) => (setEmoji(next), savePage({ iconEmoji: next })) : undefined}
      />
      <PageBarPortal slot="status">
        <div className="flex items-center gap-1 text-[13px] text-os-muted" aria-live="polite">
          {SYNC_LABEL[syncState]}
        </div>
      </PageBarPortal>
      <PageBarPortal slot="actions">
        {canManageAccess && <PageBarShareButton onClick={() => setShareOpen(true)} />}
        {actionsSlot}
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
        <ReadOnlyDeck
          slides={snap.slides}
          themeId={snap.themeId}
          notice="This deck was made with a newer version of Slides, so you can view it but not edit it."
        />
      </>
    );
  }

  const notes = current ? notesFragment(deck.doc, current.id) : null;
  const epochKey = `${snap.epoch}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-os-card bg-os-card">
      {pageBar}
      <EditorToolbar canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} onAdd={add} onImage={pickImage} />
      <div className="flex min-h-0 flex-1">
        <Filmstrip
          slides={snap.slides}
          themeId={snap.themeId}
          currentId={current?.id ?? null}
          peers={peers}
          editable
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
                key={`${epochKey}:${current.id}`}
                slide={current}
                themeId={snap.themeId}
                doc={deck.doc}
                collab={slotCollab}
                editable
                selectedSlot={selectedSlot}
                onSelectSlot={setSelectedSlot}
                onPickImage={pickImage}
              />
            ) : deletedHere ? (
              <DeletedSlideNotice by={snap.deletedBy[selectedId!] ?? null} onRestore={() => undeleteSlide(deck.doc, selectedId!)} />
            ) : (
              <EmptyState actions={<Button size="sm" onClick={() => add("title")}>New slide</Button>}>This deck doesn't have any slides yet.</EmptyState>
            )}
          </div>
          {current && notes && slotCollab && <NotesPane key={`${epochKey}:${current.id}`} fragment={notes} collab={slotCollab} />}
        </div>
        <Inspector
          slide={current}
          themeId={snap.themeId}
          slideCount={snap.slides.length}
          selectedSlot={selectedSlot}
          editable
          onLayout={(id) => current && setLayout(deck.doc, current.id, id)}
          onTheme={(id) => setThemeId(deck.doc, id)}
          onTextStyle={(slot, style) => current && setTextStyle(deck.doc, current.id, slot, style)}
          onPickImage={pickImage}
          onClearImage={() => current && clearSlotImage(deck.doc, current.id)}
        />
      </div>
      <input ref={fileRef} type="file" accept={IMAGE_UPLOAD_ACCEPT} hidden onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ""))} />
    </div>
  );
}
