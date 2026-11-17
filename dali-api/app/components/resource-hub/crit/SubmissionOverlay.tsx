import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link2, Pencil, Trash2 } from "lucide-react";
import { modalCardClass } from "~/components/os-chrome";
import { Modal, ModalHeader } from "~/components/Modal";
import { Drawer } from "~/components/ui/Drawer";
import { FilePreview } from "~/components/FilePreview";
import { FormField } from "~/components/ui/FormField";
import { IconButton } from "~/components/ui/IconButton";
import { Avatar } from "~/components/ui/Avatar";
import { Segmented } from "~/components/ui/Segmented";
import { AnchoredCard } from "~/components/ui/floating";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import { useDialog } from "~/components/ui/dialog";
import { CommentComposer } from "~/components/collab/CommentComposer";
import { CommentPins } from "~/components/slides/collab/CommentPins";
import { useSlideComments, type NewSlideComment } from "~/components/slides/collab/useSlideComments";
import { useMediaQuery } from "~/hooks/useIsMobile";
import { segmentsToPlainText, type BodySegment } from "~/lib/comment-body";
import { cn } from "~/lib/cn";
import { CritPanel, ThreadView } from "./CritComments";
import { isCommentShortcut, pointToFraction } from "./pins";
import { buildThreads, pinsOf, stepPinned, threadIsMine } from "./threads";

export interface CritSubmissionView {
  id: string;
  title: string;
  question: string | null;
  kind: string;
  url: string;
  previewUrl: string | null;
  fileName: string | null;
  anonymous: boolean;
  authorName: string | null;
  mine: boolean;
  canDelete: boolean;
  canModerate: boolean;
  commentCount: number;
  createdAt: string;
}

export interface CritViewer {
  id: string;
  name: string;
  photoUrl: string | null;
}

type Mode = "view" | "comment";
const PIN_BOX = 32;
const POPOVER_CLASS = cn(OS_SURFACE_CLASS, "w-80 max-w-[calc(100vw-16px)] p-3");

function rectAt(left: number, top: number): DOMRect {
  return { left, top, right: left + PIN_BOX, bottom: top + PIN_BOX, width: PIN_BOX, height: PIN_BOX, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function PostActions({ submission, onStartEdit, onDelete }: { submission: CritSubmissionView; onStartEdit?: () => void; onDelete?: () => void }) {
  const dialog = useDialog();
  return (
    <>
      {submission.mine && onStartEdit && (
        <IconButton label="Edit post" icon={Pencil} onClick={onStartEdit} className="h-8 w-8" />
      )}
      {submission.canDelete && onDelete && (
        <IconButton
          label="Delete post"
          icon={Trash2}
          tone="destructive"
          className="h-8 w-8"
          onClick={async () => {
            if (await dialog.confirm({ title: "Delete this post?", description: "Its comments will be deleted too.", confirmLabel: "Delete", tone: "destructive" })) onDelete();
          }}
        />
      )}
    </>
  );
}

function EditPostForm({ submission, onSave, onCancel }: { submission: CritSubmissionView; onSave: (title: string, question: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(submission.title);
  const [question, setQuestion] = useState(submission.question ?? "");
  return (
    <div className="os-form flex flex-col gap-2 rounded-lg bg-os-bg p-3">
      <FormField label="Title" labelHidden value={title} maxLength={120} onChange={setTitle} />
      <FormField label="Question" labelHidden multiline rows={2} value={question} maxLength={400} placeholder="What would you like feedback on?" onChange={setQuestion} />
      <div className="flex justify-end gap-2">
        <button type="button" className="os-btn-ghost text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" disabled={!title.trim()} className="os-btn-primary os-btn-primary--sm disabled:opacity-50" onClick={() => onSave(title, question)}>
          Save
        </button>
      </div>
    </div>
  );
}

function LinkBlock({ submission }: { submission: CritSubmissionView }) {
  const host = (() => {
    try {
      return new URL(submission.url).hostname.replace(/^www\./, "");
    } catch {
      return submission.url;
    }
  })();
  return (
    <div className="flex flex-col gap-3">
      {submission.previewUrl ? (
        <img src={submission.previewUrl} alt="" referrerPolicy="no-referrer" className="aspect-video w-full rounded-xl border border-os-container object-cover" />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-os-container bg-os-bg text-os-grey">
          <Link2 className="h-6 w-6" aria-hidden />
          <span className="text-xs">{host}</span>
        </div>
      )}
      <a href={submission.url} target="_blank" rel="noopener noreferrer" className="os-btn-primary os-btn-primary--sm w-fit">
        Open link
      </a>
    </div>
  );
}

export function SubmissionOverlay({
  viewer,
  submission,
  initialThreadId = null,
  onClose,
  onChanged,
  onEdit,
  onDelete,
}: {
  viewer: CritViewer;
  submission: CritSubmissionView;
  initialThreadId?: string | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit?: (title: string, question: string) => void;
  onDelete?: () => void;
}) {
  const isImage = submission.kind === "image";
  const wide = useMediaQuery("(min-width: 1024px)");
  const comments = useSlideComments(submission.id, true, "crit");
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const deepLinked = useRef(false);

  const api = useMemo(
    () => ({
      post: async (input: NewSlideComment) => {
        const ok = await comments.post(input);
        if (ok) onChanged();
        return ok;
      },
      remove: async (id: string) => {
        const ok = await comments.remove(id);
        if (ok) onChanged();
        return ok;
      },
      edit: comments.edit,
      react: comments.react,
    }),
    [comments.post, comments.remove, comments.edit, comments.react, onChanged],
  );
  const threads = useMemo(() => buildThreads(comments.comments), [comments.comments]);
  const shown = mineOnly ? threads.filter((t) => threadIsMine(t, viewer.id)) : threads;
  const active = threads.find((t) => t.root.id === activeId) ?? null;
  const popoverThread = wide && active?.pin ? active : null;
  const viewerCtx = { id: viewer.id, canModerate: submission.canModerate };
  const pinned = threads.filter((t) => t.pin);

  useEffect(() => {
    if (!comments.loaded || deepLinked.current || !initialThreadId) return;
    deepLinked.current = true;
    if (threads.some((t) => t.root.id === initialThreadId)) setActiveId(initialThreadId);
  }, [comments.loaded, initialThreadId, threads]);

  useEffect(() => {
    const onResize = () => setLayoutTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const point = draft ?? popoverThread?.pin ?? null;
    const box = imgRef.current?.getBoundingClientRect();
    if (!wide || !point || !box) return setAnchorRect(null);
    setAnchorRect(rectAt(box.left + point.x * box.width - PIN_BOX / 2, box.top + point.y * box.height - PIN_BOX / 2));
  }, [wide, draft, popoverThread, layoutTick]);

  useEffect(() => {
    if (wide || !activeId) return;
    requestAnimationFrame(() => document.querySelector(`[data-thread-row="${activeId}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
  }, [wide, activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if ((e.target as Element | null)?.closest?.('[role="menu"]')) return;
        if (draft) setDraft(null);
        else if (activeId) setActiveId(null);
        else if (mode === "comment") setMode("view");
        return;
      }
      if (isImage && isCommentShortcut(e)) {
        e.preventDefault();
        setDraft(null);
        setMode((m) => (m === "comment" ? "view" : "comment"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isImage, draft, activeId, mode]);

  const changeMode = (next: Mode) => {
    setDraft(null);
    setMode(next);
  };
  const openThread = (id: string) => {
    setDraft(null);
    setActiveId(id);
  };
  const postDraft = async (segments: BodySegment[]) => {
    if (!draft) return;
    setDraftBusy(true);
    const ok = await api.post({ body: segmentsToPlainText(segments), bodyJson: segments, parentId: null, anchor: { kind: "image", ...draft } });
    setDraftBusy(false);
    if (ok) (setDraft(null), setDraftBody(""));
  };
  const draftComposer = draft && (
    <CommentComposer autoFocus currentUserId={viewer.id} value={draftBody} onChange={setDraftBody} busy={draftBusy} placeholder="Add a comment" submitLabel="Post" onCancel={() => setDraft(null)} onSubmit={postDraft} />
  );

  const actions = (
    <>
      {isImage && (
        <>
          <Segmented<Mode>
            ariaLabel="Mode"
            value={mode}
            onChange={changeMode}
            options={[
              { value: "view", label: "View" },
              { value: "comment", label: "Comment" },
            ]}
          />
          {wide && <kbd className="rounded border border-os-container-hi px-1 text-[10px] text-os-grey">C</kbd>}
        </>
      )}
      <PostActions submission={submission} onStartEdit={() => setEditing(true)} onDelete={onDelete} />
    </>
  );
  const editForm = editing ? (
    <EditPostForm
      submission={submission}
      onCancel={() => setEditing(false)}
      onSave={(t, q) => {
        onEdit?.(t, q);
        setEditing(false);
      }}
    />
  ) : null;
  const panel = (
    <CritPanel
      question={submission.question}
      editForm={editForm}
      threads={shown}
      allCount={threads.length}
      total={comments.comments.length}
      loaded={comments.loaded}
      error={comments.error}
      viewer={viewerCtx}
      api={api}
      isImage={isImage}
      wide={wide}
      activeId={activeId}
      mineOnly={mineOnly}
      onMineChange={setMineOnly}
      onOpen={openThread}
      onHide={() => setActiveId(null)}
      draftComposer={
        draft && !wide ? (
          <div className="flex flex-col gap-1 rounded-xl border border-os-container p-2">
            <span className="text-xs text-muted-foreground">Comment on this spot</span>
            {draftComposer}
          </div>
        ) : null
      }
    />
  );
  const byline = submission.anonymous ? "Anonymous" : (submission.authorName ?? "");
  const swallowEscape = mode === "comment" || !!draft || !!activeId;

  if (submission.kind === "link") {
    return (
      <Drawer open onClose={onClose} title={submission.title} headerActions={actions} width={480} disableEscape={swallowEscape}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          {byline && <p className="text-xs text-os-grey">{byline}</p>}
          <LinkBlock submission={submission} />
          {panel}
        </div>
      </Drawer>
    );
  }

  const imageArea = isImage ? (
    <div className="flex min-w-0 flex-col items-center gap-3">
      <div
        className={cn("relative inline-block max-w-full", mode === "comment" && "cursor-crosshair")}
        onClick={(e) => {
          if (mode !== "comment" || (e.target as HTMLElement).closest("[data-comment-pin]")) return;
          const box = imgRef.current?.getBoundingClientRect();
          const point = box && pointToFraction(e.clientX, e.clientY, box);
          if (point) (setActiveId(null), setDraft(point));
        }}
      >
        <img
          ref={imgRef}
          src={submission.url}
          alt={submission.title}
          draggable={false}
          onLoad={() => setLayoutTick((n) => n + 1)}
          className="block max-h-[70vh] max-w-full select-none rounded-lg border border-os-container bg-os-card"
        />
        <CommentPins pins={pinsOf(shown)} focusedId={activeId} onOpen={openThread} size="sm" />
        {draft && (
          <span data-draft-pin className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-os-accent" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}>
            <Avatar name={viewer.name} photoUrl={viewer.photoUrl} size="sm" />
          </span>
        )}
      </div>
      {mode === "comment" && <span className="text-xs text-os-grey">{wide ? "Click the image to leave a comment. Esc to go back." : "Tap the image to leave a comment."}</span>}
    </div>
  ) : (
    <FilePreview previewUrl={submission.url} downloadUrl={submission.url} fileName={submission.fileName ?? submission.title} />
  );

  const floating = (
    <>
      {draft && wide && anchorRect && (
        <AnchoredCard anchor={anchorRect} onClose={() => setDraft(null)} ariaLabel="New comment" className={POPOVER_CLASS}>
          {draftComposer}
        </AnchoredCard>
      )}
      {popoverThread && anchorRect && (
        <AnchoredCard anchor={anchorRect} onClose={() => setActiveId(null)} ariaLabel="Comment thread" className={cn(POPOVER_CLASS, "max-h-[70vh] overflow-y-auto")}>
          <ThreadView
            key={popoverThread.root.id}
            thread={popoverThread}
            viewer={viewerCtx}
            api={api}
            step={{
              index: pinned.findIndex((t) => t.root.id === popoverThread.root.id),
              total: pinned.length,
              onPrev: () => setActiveId(stepPinned(threads, popoverThread.root.id, -1)),
              onNext: () => setActiveId(stepPinned(threads, popoverThread.root.id, 1)),
            }}
          />
        </AnchoredCard>
      )}
    </>
  );
  if (!wide) {
    return (
      <Drawer open onClose={onClose} title={submission.title} headerActions={actions} width={480} disableEscape={swallowEscape}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          {byline && <p className="text-xs text-os-grey">{byline}</p>}
          {imageArea}
          {panel}
        </div>
      </Drawer>
    );
  }

  return (
    <Modal open onClose={onClose} labelledBy="crit-overlay-title" disableEscape={swallowEscape} containerClassName={modalCardClass("max-w-6xl")}>
      <ModalHeader titleId="crit-overlay-title" title={submission.title} subtitle={byline || undefined} onClose={onClose} className="!mb-4" actions={actions} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {imageArea}
        <div className="lg:max-h-[75vh] lg:overflow-y-auto">{panel}</div>
      </div>
      {floating}
    </Modal>
  );
}
