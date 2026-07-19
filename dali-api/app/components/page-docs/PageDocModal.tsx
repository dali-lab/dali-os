import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Upload, Trash2, Loader2, UserCog, X } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { RichTextEditor } from "~/components/RichTextEditor";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import { CommentsRail } from "~/components/collab/CommentsRail";
import { buttonClasses } from "~/components/ui/Button";
import { uploadFileToS3 } from "~/lib/upload-client";
import { MAX_UPLOAD_LABEL } from "~/lib/file-validation";
import { searchMentionableUsers, type MentionUser } from "~/components/editor/mention";
import { Tooltip } from "~/components/ui/IconButton";

type Maintainer = { id: string; name: string; handle: string | null };

type DocData = {
  doc: { id: string; title: string; body: unknown; videoUrl: string | null; hasVideo: boolean };
  maintainer: Maintainer | null;
  canEdit: boolean;
  canAssignMaintainer: boolean;
  currentUserId: string;
};

const CONTAINER_CLASS =
  "bg-card rounded-2xl shadow-brand-2 max-w-4xl w-full p-5 sm:p-6 my-auto max-h-[90vh] overflow-y-auto";
const SECTION_LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const EMPTY_CLASS = "py-2 text-sm text-muted-foreground";

const TITLE_ID = "page-doc-modal-title";

export function PageDocModal({
  docKey,
  fallbackTitle,
  path,
  focusCommentId,
  onClose,
}: {
  docKey: string;
  fallbackTitle: string;
  path: string;
  focusCommentId?: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<DocData | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/page-docs/${encodeURIComponent(docKey)}?title=${encodeURIComponent(fallbackTitle)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setData((await res.json()) as DocData);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [docKey, fallbackTitle]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal open onClose={onClose} labelledBy={TITLE_ID} containerClassName={CONTAINER_CLASS}>
      {editing ? (
        <div className="flex items-start justify-end mb-4">
          <h2 id={TITLE_ID} className="sr-only">
            Edit {data?.doc.title ?? fallbackTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>
      ) : (
        <ModalHeader
          titleId={TITLE_ID}
          title={data?.doc.title ?? fallbackTitle}
          subtitle={
            data?.maintainer
              ? `Maintained by ${data.maintainer.name}${data.maintainer.handle ? ` · @${data.maintainer.handle}` : ""}`
              : "No maintainer assigned yet"
          }
          onClose={onClose}
        />
      )}

      {status === "loading" && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        </div>
      )}

      {status === "error" && (
        <div className={EMPTY_CLASS}>Couldn't load this guide. Try again in a moment.</div>
      )}

      {status === "ready" && data && (
        <div className="flex flex-col gap-5">
          {data.canEdit && !editing && (
            <div className="flex justify-end">
              <Tooltip label="Edit guide">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="Edit guide"
                  className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              </Tooltip>
            </div>
          )}

          {editing ? (
            <EditPanel
              data={data}
              path={path}
              docKey={docKey}
              onSaved={async () => {
                setEditing(false);
                await load();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <ReadPanel data={data} />
          )}

          <section className="flex flex-col gap-2">
            <h3 className={SECTION_LABEL_CLASS}>FAQ</h3>
            <CommentsRail
              targetType="pagedoc"
              targetId={data.doc.id}
              currentUserId={data.currentUserId}
              canComment
              canResolve={data.maintainer?.id === data.currentUserId}
              mentionPath={path}
              focusCommentId={focusCommentId}
            />
          </section>
        </div>
      )}
    </Modal>
  );
}

function ReadPanel({ data }: { data: DocData }) {
  const emptyBody = isEmptyDoc(data.doc.body);
  return (
    <div className="flex flex-col gap-5">
      {data.doc.videoUrl && (
        <video
          src={data.doc.videoUrl}
          controls
          className="w-full rounded-lg bg-black"
        />
      )}

      {emptyBody ? (
        <p className={EMPTY_CLASS}>No guide written yet.</p>
      ) : (
        <RichTextViewer content={data.doc.body} enableMentions />
      )}
    </div>
  );
}

function EditPanel({
  data,
  path,
  docKey,
  onSaved,
  onCancel,
}: {
  data: DocData;
  path: string;
  docKey: string;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(data.doc.title);
  const [body, setBody] = useState<unknown>(data.doc.body);
  // videoKey: undefined = leave as-is, null = remove, string = new upload.
  const [videoKey, setVideoKey] = useState<string | null | undefined>(undefined);
  const [videoName, setVideoName] = useState<string | null>(data.doc.hasVideo ? "Current video" : null);
  const [maintainerId, setMaintainerId] = useState<string | null>(data.maintainer?.id ?? null);
  const [maintainerLabel, setMaintainerLabel] = useState<string | null>(
    data.maintainer ? data.maintainer.name : null,
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onPickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { s3Key } = await uploadFileToS3(file, "page-docs", "video/*");
      setVideoKey(s3Key);
      setVideoName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { title: title.trim(), body, path };
      if (videoKey !== undefined) payload.videoKey = videoKey;
      if (data.canAssignMaintainer) payload.maintainerId = maintainerId;
      const res = await fetch(`/api/page-docs/${encodeURIComponent(docKey)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? "Couldn't save changes.");
        return;
      }
      await onSaved();
    } catch {
      setError("Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-1">
        <span className={SECTION_LABEL_CLASS}>Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
      </label>

      {data.canAssignMaintainer && (
        <div className="flex flex-col gap-1">
          <span className={SECTION_LABEL_CLASS}>Maintainer</span>
          <MaintainerPicker
            currentLabel={maintainerLabel}
            onSelect={(u) => {
              setMaintainerId(u?.id ?? null);
              setMaintainerLabel(u?.name ?? null);
            }}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL_CLASS}>Walkthrough video</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            {videoName ? "Replace video" : "Upload video"}
          </button>
          {videoName && (
            <>
              <span className="text-xs text-muted-foreground">{videoName}</span>
              <button
                type="button"
                onClick={() => {
                  setVideoKey(null);
                  setVideoName(null);
                }}
                className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
              </button>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            onChange={onPickVideo}
            className="hidden"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          Up to {MAX_UPLOAD_LABEL}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL_CLASS}>Guide</span>
        <RichTextEditor
          value={body}
          onChange={setBody}
          enableMentions
          richToolbar
          placeholder="Explain what this page does."
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-lg text-foreground/80 hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || uploading || !title.trim()}
          className={buttonClasses("primary", "sm")}
        >
          {saving ? "Saving…" : "Save guide"}
        </button>
      </div>
    </div>
  );
}

// Small typeahead to (re)assign the maintainer. Reuses the mention search, which
// returns lab members who have a handle.
function MaintainerPicker({
  currentLabel,
  onSelect,
}: {
  currentLabel: string | null;
  onSelect: (user: MentionUser | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MentionUser[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(currentLabel);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void searchMentionableUsers(query).then((r) => {
      if (active) setResults(r);
    });
    return () => {
      active = false;
    };
  }, [query, open]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <UserCog className="h-4 w-4 text-muted-foreground" aria-hidden />
        <input
          value={open ? query : selectedLabel ?? ""}
          placeholder={selectedLabel ?? "Search members…"}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        {selectedLabel && (
          <button
            type="button"
            onClick={() => {
              setSelectedLabel(null);
              onSelect(null);
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card py-1 text-sm shadow-brand-2">
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setSelectedLabel(u.name);
                setOpen(false);
                onSelect(u);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/60"
            >
              <span className="font-medium text-foreground">{u.name}</span>
              <span className="text-xs text-muted-foreground">@{u.handle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
