import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { Drawer } from "~/components/ui/Drawer";
import { FilePreview } from "~/components/FilePreview";
import { FormField } from "~/components/ui/FormField";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { isCommentShortcut, pointToFraction } from "./pins";
import { Z } from "~/components/ui/z";

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
  commentCount: number;
  createdAt: string;
}

export interface CritCommentView {
  id: string;
  parentId: string | null;
  body: string;
  x: number | null;
  y: number | null;
  pin: number | null;
  authorName: string;
  mine: boolean;
  canDelete: boolean;
  createdAt: string;
}

function Composer({
  placeholder,
  submitLabel,
  autoFocus,
  busy,
  rows = 2,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  busy: boolean;
  rows?: number;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const send = async () => {
    if (!text.trim() || busy) return;
    if (await onSubmit(text.trim())) setText("");
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="os-form">
        <FormField
          label={placeholder}
          labelHidden
          multiline
          autoFocus={autoFocus}
          rows={rows}
          value={text}
          placeholder={placeholder}
          onChange={setText}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="os-btn-ghost text-sm">
            Cancel
          </button>
        )}
        <button type="button" disabled={!text.trim() || busy} onClick={() => void send()} className="os-btn-primary os-btn-primary--sm disabled:opacity-50">
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function Pin({ n, selected, style, onClick }: { n: number | string; selected?: boolean; style: React.CSSProperties; onClick?: () => void }) {
  return (
    <button
      type="button"
      data-pin
      aria-label={typeof n === "number" ? `Comment ${n}` : "New comment"}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      style={style}
      className={`absolute z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-os-accent text-xs font-semibold text-foreground shadow-sm ring-2 ring-white transition-transform duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-os-accent/60 ${selected ? "scale-110 ring-os-accent/40" : "hover:scale-105"}`}
    >
      {n}
    </button>
  );
}

function useCritComments(endpoint: string, onChanged: () => void) {
  const [comments, setComments] = useState<CritCommentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(endpoint)
      .then((r) => (r.ok ? (r.json() as Promise<{ comments: CritCommentView[] }>) : Promise.reject(new Error())))
      .then((d) => live && setComments(d.comments))
      .catch(() => live && setError("Couldn't load comments."));
    return () => {
      live = false;
    };
  }, [endpoint]);

  const post = useCallback(
    async (fields: Record<string, string>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const body = new FormData();
        Object.entries(fields).forEach(([k, v]) => body.set(k, v));
        const res = await fetch(endpoint, { method: "POST", body });
        const data = (await res.json()) as { comments?: CritCommentView[]; error?: string };
        if (!res.ok || !data.comments) {
          setError(data.error ?? "Something went wrong.");
          return false;
        }
        setComments(data.comments);
        onChanged();
        return true;
      } catch {
        setError("Something went wrong.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [endpoint, onChanged],
  );
  return { comments, error, busy, post };
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

function ThreadPanel({
  submission,
  comments,
  error,
  busy,
  post,
  selected,
  setSelected,
  isImage,
  editForm,
  panelRef,
}: {
  submission: CritSubmissionView;
  comments: CritCommentView[] | null;
  error: string | null;
  busy: boolean;
  post: (fields: Record<string, string>) => Promise<boolean>;
  selected: string | null;
  setSelected: (id: string | null) => void;
  isImage: boolean;
  editForm: React.ReactNode;
  panelRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const topLevel = (comments ?? []).filter((c) => !c.parentId);
  const repliesOf = (id: string) => (comments ?? []).filter((c) => c.parentId === id);
  const remove = (id: string) => void post({ intent: "delete-comment", commentId: id });
  return (
    <div ref={panelRef} className="flex min-h-0 flex-col gap-3">
      {editForm ?? (submission.question && <p className="rounded-lg bg-os-bg px-3 py-2 text-sm text-foreground [overflow-wrap:anywhere]">{submission.question}</p>)}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {comments === null && !error && <p className="text-sm text-os-grey">Loading comments…</p>}
      {comments && topLevel.length === 0 && <p className="text-sm text-os-grey">{isImage ? "No comments yet. Press C to pin one to the image." : "No comments yet."}</p>}
      <ul className="flex flex-col gap-2">
        {topLevel.map((c) => {
          const open = selected === c.id;
          return (
            <li key={c.id} data-thread={c.id} className={`rounded-xl px-3 py-2 transition-colors duration-150 ${open ? "bg-os-accent/20" : "bg-os-accent/10"}`}>
              <button type="button" onClick={() => setSelected(open ? null : c.id)} aria-expanded={open} className="flex w-full items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60">
                {c.pin !== null && <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-os-accent text-[11px] font-semibold text-foreground">{c.pin}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-foreground">{c.authorName}</span>
                  <span className={`block text-sm text-foreground [overflow-wrap:anywhere] ${open ? "" : "line-clamp-2"}`}>{c.body}</span>
                </span>
              </button>
              {open && (
                <div className="mt-2 flex flex-col gap-2 border-t border-os-accent/20 pt-2">
                  {repliesOf(c.id).map((r) => (
                    <div key={r.id} className="flex items-start justify-between gap-2 pl-1">
                      <div className="min-w-0">
                        <span className="block text-xs font-medium text-foreground">{r.authorName}</span>
                        <span className="block text-sm text-foreground [overflow-wrap:anywhere]">{r.body}</span>
                      </div>
                      {r.canDelete && (
                        <button type="button" aria-label="Delete reply" title="Delete" onClick={() => remove(r.id)} className="rounded p-1 text-os-grey hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  ))}
                  <Composer placeholder="Reply" submitLabel="Reply" busy={busy} rows={1} onSubmit={(body) => post({ intent: "comment", body, parentId: c.id })} />
                  {c.canDelete && (
                    <button type="button" onClick={() => remove(c.id)} className="flex w-fit items-center gap-1.5 text-xs text-os-grey hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Delete comment
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="border-t border-os-container pt-3">
        <Composer placeholder="Add a comment" submitLabel="Comment" busy={busy} onSubmit={(body) => post({ intent: "comment", body })} />
      </div>
    </div>
  );
}

export function SubmissionOverlay({
  pageId,
  submission,
  onClose,
  onChanged,
  onEdit,
  onDelete,
}: {
  pageId: string;
  submission: CritSubmissionView;
  onClose: () => void;
  onChanged: () => void;
  onEdit?: (title: string, question: string) => void;
  onDelete?: () => void;
}) {
  const endpoint = `/resource-hub/${pageId}/crit/${submission.id}`;
  const isImage = submission.kind === "image";
  const { comments, error, busy, post } = useCritComments(endpoint, onChanged);
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (draft) setDraft(null);
        else if (placing) setPlacing(false);
        return;
      }
      if (isCommentShortcut(e)) {
        e.preventDefault();
        setDraft(null);
        setPlacing((p) => !p);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isImage, placing, draft]);

  const pinned = (comments ?? []).filter((c) => !c.parentId && c.pin !== null && c.x !== null && c.y !== null);
  const select = (id: string | null) => {
    setSelected(id);
    if (id) requestAnimationFrame(() => panelRef.current?.querySelector(`[data-thread="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const actions = <PostActions submission={submission} onStartEdit={() => setEditing(true)} onDelete={onDelete} />;
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
  const thread = (
    <ThreadPanel submission={submission} comments={comments} error={error} busy={busy} post={post} selected={selected} setSelected={select} isImage={isImage} editForm={editForm} panelRef={panelRef} />
  );
  const byline = submission.anonymous ? "Anonymous" : (submission.authorName ?? "");

  if (submission.kind === "link") {
    return (
      <Drawer open onClose={onClose} title={submission.title} headerActions={actions}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          {byline && <p className="text-xs text-os-grey">{byline}</p>}
          <LinkBlock submission={submission} />
          {thread}
        </div>
      </Drawer>
    );
  }

  const imageArea = isImage ? (
    <div className="flex min-w-0 flex-col items-center gap-3">
      <div className="flex w-full items-center justify-between">
        <button
          type="button"
          aria-pressed={placing}
          onClick={() => {
            setDraft(null);
            setPlacing((p) => !p);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60 ${placing ? "bg-os-accent/15 font-medium text-foreground" : "text-os-grey hover:bg-os-hover hover:text-foreground"}`}
        >
          <MessageSquarePlus className="h-4 w-4" aria-hidden />
          Comment
          <kbd className="rounded border border-os-container-hi px-1 text-[10px] text-os-grey">C</kbd>
        </button>
        {placing && <span className="text-xs text-os-grey">Click the image to place a comment. Esc to cancel.</span>}
      </div>
      <div
        className={`relative inline-block max-w-full overflow-visible rounded-lg ${placing ? "cursor-crosshair" : ""}`}
        onClick={(e) => {
          if (!placing || (e.target as HTMLElement).closest("[data-pin],[data-composer]")) return;
          const rect = imgRef.current?.getBoundingClientRect();
          const point = rect && pointToFraction(e.clientX, e.clientY, rect);
          if (point) {
            setDraft(point);
            setPlacing(false);
          }
        }}
      >
        <img ref={imgRef} src={submission.url} alt={submission.title} draggable={false} className="block max-h-[70vh] max-w-full select-none rounded-lg border border-os-container bg-os-card" />
        {pinned.map((c) => (
          <Pin key={c.id} n={c.pin!} selected={selected === c.id} style={{ left: `${c.x! * 100}%`, top: `${c.y! * 100}%` }} onClick={() => select(c.id)} />
        ))}
        {draft && (
          <>
            <Pin n="+" selected style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }} />
            <div
              data-composer
              role="dialog"
              aria-label="New comment"
              className="absolute z-20 w-64 rounded-xl border border-os-container bg-os-card p-3 shadow-lg"
              style={{ top: `${draft.y * 100}%`, ...(draft.x > 0.55 ? { right: `${(1 - draft.x) * 100}%`, marginRight: 18 } : { left: `${draft.x * 100}%`, marginLeft: 18 }), transform: "translateY(-12px)" }}
            >
              <Composer
                autoFocus
                placeholder="Add a comment"
                submitLabel="Comment"
                busy={busy}
                onCancel={() => setDraft(null)}
                onSubmit={async (body) => {
                  const ok = await post({ intent: "comment", body, x: String(draft.x), y: String(draft.y) });
                  if (ok) setDraft(null);
                  return ok;
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  ) : (
    <FilePreview previewUrl={submission.url} downloadUrl={submission.url} fileName={submission.fileName ?? submission.title} />
  );

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="crit-overlay-title"
      disableEscape={placing || !!draft}
      className={`fixed inset-0 ${Z.top} flex overflow-y-auto bg-black/40 p-3 sm:p-6`}
      containerClassName="m-auto w-full max-w-6xl rounded-os-card bg-os-card p-4 shadow-xl sm:p-6"
    >
      <ModalHeader titleId="crit-overlay-title" title={submission.title} subtitle={byline || undefined} onClose={onClose} className="!mb-4" actions={actions} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {imageArea}
        <div className="lg:max-h-[75vh] lg:overflow-y-auto">{thread}</div>
      </div>
    </Modal>
  );
}
