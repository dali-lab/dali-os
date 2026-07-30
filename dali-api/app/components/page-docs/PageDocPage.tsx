import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pencil,
  Upload,
  Trash2,
  Loader2,
  UserCog,
  Plus,
  ChevronUp,
  ChevronDown,
  X,
} from "lucide-react";
import { RichTextEditor } from "~/components/RichTextEditor";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import { CommentsRail } from "~/components/collab/CommentsRail";
import { buttonClasses } from "~/components/ui/Button";
import { uploadFileToS3 } from "~/lib/upload-client";
import { MAX_UPLOAD_LABEL } from "~/lib/file-validation";
import { searchMentionableUsers, type MentionUser } from "~/components/editor/mention";
import { Tooltip } from "~/components/ui/IconButton";

type Maintainer = { id: string; name: string; handle: string | null };

type SectionData = {
  id: string;
  title: string;
  body: unknown;
  videoUrl: string | null;
  hasVideo: boolean;
};

type DocData = {
  doc: {
    id: string;
    title: string;
    body: unknown;
    videoUrl: string | null;
    hasVideo: boolean;
    sections: SectionData[];
  };
  maintainer: Maintainer | null;
  canEdit: boolean;
  canAssignMaintainer: boolean;
  currentUserId: string;
};

/** Draft section while editing. videoKeyChange: undefined = leave, null = remove, string = new. */
type DraftSection = {
  id: string;
  title: string;
  body: unknown;
  hasVideo: boolean;
  videoUrl: string | null;
  videoKeyChange?: string | null;
  videoLabel: string | null;
};

const SECTION_LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const EMPTY_CLASS = "py-2 text-sm text-muted-foreground";

const TITLE_ID = "page-doc-page-title";

function newClientSectionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `sec_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `sec_${Math.random().toString(16).slice(2, 18)}`;
}

function toDraftSections(sections: SectionData[]): DraftSection[] {
  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    body: s.body,
    hasVideo: s.hasVideo,
    videoUrl: s.videoUrl,
    videoLabel: s.hasVideo ? "Current video" : null,
  }));
}

export function PageDocPage({
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
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  // Edit draft state lives here so Cancel/Save can sit in the shared header.
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSections, setDraftSections] = useState<DraftSection[]>([]);
  const [maintainerId, setMaintainerId] = useState<string | null>(null);
  const [maintainerLabel, setMaintainerLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      const next = (await res.json()) as DocData;
      setData(next);
      setActiveSectionId((prev) => {
        const ids = next.doc.sections.map((s) => s.id);
        if (prev && ids.includes(prev)) return prev;
        return ids[0] ?? null;
      });
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [docKey, fallbackTitle]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEditing() {
    if (!data) return;
    setDraftTitle(data.doc.title);
    setDraftSections(toDraftSections(data.doc.sections));
    setMaintainerId(data.maintainer?.id ?? null);
    setMaintainerLabel(data.maintainer?.name ?? null);
    setSaveError(null);
    setEditing(true);
    const ids = data.doc.sections.map((s) => s.id);
    if (!activeSectionId || !ids.includes(activeSectionId)) {
      setActiveSectionId(ids[0] ?? null);
    }
  }

  function cancelEditing() {
    setEditing(false);
    setSaveError(null);
    setUploading(false);
  }

  async function save() {
    if (!data) return;
    const title = draftTitle.trim();
    if (!title) {
      setSaveError("Title is required.");
      return;
    }
    if (draftSections.length === 0) {
      setSaveError("Add at least one section.");
      return;
    }
    if (draftSections.some((s) => !s.title.trim())) {
      setSaveError("Every section needs a title.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const sections = draftSections.map((s) => {
        const row: Record<string, unknown> = {
          id: s.id,
          title: s.title.trim(),
          body: s.body,
        };
        if (s.videoKeyChange !== undefined) row.videoKey = s.videoKeyChange;
        return row;
      });
      const payload: Record<string, unknown> = { title, sections, path };
      if (data.canAssignMaintainer) payload.maintainerId = maintainerId;

      const res = await fetch(`/api/page-docs/${encodeURIComponent(docKey)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(b.error ?? "Couldn't save changes.");
        return;
      }
      setEditing(false);
      await load();
    } catch {
      setSaveError("Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  const sections = editing ? draftSections : (data?.doc.sections ?? []);
  const active =
    sections.find((s) => s.id === activeSectionId) ?? sections[0] ?? null;

  const headerActions =
    status === "ready" && data?.canEdit ? (
      editing ? (
        <>
          <button
            type="button"
            onClick={cancelEditing}
            disabled={saving}
            className="px-2.5 py-1 text-sm rounded-md text-foreground/80 hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || uploading || !draftTitle.trim()}
            className={buttonClasses("primary", "sm")}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      ) : (
        <Tooltip label="Edit guide">
          <button
            type="button"
            onClick={startEditing}
            aria-label="Edit guide"
            className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
        </Tooltip>
      )
    ) : null;

  return (
    <div className="flex min-h-[70vh] flex-col gap-5" aria-labelledby={TITLE_ID}>
      <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0 flex-1">
          {/* The input lives inside the h1 so the heading — and the
              aria-labelledby that points at it — survives edit mode; a text
              input's value carries into the accessible name. */}
          <h1 id={TITLE_ID} className="font-heading text-xl font-bold text-foreground sm:text-2xl">
            {editing ? (
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder={fallbackTitle}
                aria-label="Guide title"
                className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 -ml-1.5 font-heading text-xl font-bold text-foreground hover:border-border focus:border-border focus:bg-background focus:outline-none focus:ring-2 focus:ring-accent-coral/30 sm:text-2xl"
              />
            ) : (
              (data?.doc.title ?? fallbackTitle)
            )}
          </h1>
          {editing && data?.canAssignMaintainer ? (
            <div className="mt-1.5 max-w-sm">
              <MaintainerPicker
                currentLabel={maintainerLabel}
                onSelect={(u) => {
                  setMaintainerId(u?.id ?? null);
                  setMaintainerLabel(u?.name ?? null);
                }}
              />
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data?.maintainer
                ? `Maintained by ${data.maintainer.name}${data.maintainer.handle ? ` · @${data.maintainer.handle}` : ""}`
                : "No maintainer assigned yet"}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {headerActions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>
      </header>

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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <SectionSidebar
              sections={sections.map((s) => ({ id: s.id, title: s.title }))}
              activeId={active?.id ?? null}
              editing={editing}
              onSelect={setActiveSectionId}
              onAdd={() => {
                const id = newClientSectionId();
                setDraftSections((prev) => [
                  ...prev,
                  {
                    id,
                    title: "New section",
                    body: null,
                    hasVideo: false,
                    videoUrl: null,
                    videoLabel: null,
                  },
                ]);
                setActiveSectionId(id);
              }}
              onRename={(id, title) => {
                setDraftSections((prev) =>
                  prev.map((s) => (s.id === id ? { ...s, title } : s)),
                );
              }}
              onMove={(id, dir) => {
                setDraftSections((prev) => {
                  const i = prev.findIndex((s) => s.id === id);
                  if (i < 0) return prev;
                  const j = dir === "up" ? i - 1 : i + 1;
                  if (j < 0 || j >= prev.length) return prev;
                  const next = [...prev];
                  const tmp = next[i]!;
                  next[i] = next[j]!;
                  next[j] = tmp;
                  return next;
                });
              }}
              onDelete={(id) => {
                setDraftSections((prev) => {
                  if (prev.length <= 1) return prev;
                  const next = prev.filter((s) => s.id !== id);
                  if (activeSectionId === id) setActiveSectionId(next[0]?.id ?? null);
                  return next;
                });
              }}
            />

            <div className="min-w-0 flex-1 flex flex-col gap-4">
              {active ? (
                editing ? (
                  <SectionEditPanel
                    section={active as DraftSection}
                    uploading={uploading}
                    onUploading={setUploading}
                    onChange={(patch) => {
                      setDraftSections((prev) =>
                        prev.map((s) => (s.id === active.id ? { ...s, ...patch } : s)),
                      );
                    }}
                  />
                ) : (
                  <SectionReadPanel section={active as SectionData} />
                )
              ) : (
                <p className={EMPTY_CLASS}>No sections yet.</p>
              )}
            </div>
          </div>

          {saveError && <p className="text-sm text-destructive">{saveError}</p>}

          <section className="flex flex-col gap-2 border-t border-border pt-5">
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
    </div>
  );
}

function SectionSidebar({
  sections,
  activeId,
  editing,
  onSelect,
  onAdd,
  onRename,
  onMove,
  onDelete,
}: {
  sections: { id: string; title: string }[];
  activeId: string | null;
  editing: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="w-full shrink-0 sm:w-52 sm:border-r sm:border-border sm:pr-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className={SECTION_LABEL_CLASS}>Sections</h3>
        {editing && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add
          </button>
        )}
      </div>
      <nav className="flex flex-row gap-1 overflow-x-auto sm:flex-col sm:overflow-visible" aria-label="Guide sections">
        {sections.map((s, index) => {
          const selected = s.id === activeId;
          return (
            <div
              key={s.id}
              className={`group flex min-w-[8rem] flex-col gap-1 rounded-md sm:min-w-0 ${
                selected ? "bg-muted/70" : "hover:bg-muted/40"
              }`}
            >
              {editing ? (
                <div className="flex items-center gap-0.5 p-1">
                  <input
                    value={s.title}
                    onFocus={() => onSelect(s.id)}
                    onChange={(e) => onRename(s.id, e.target.value)}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-foreground focus:border-border focus:bg-background focus:outline-none"
                    aria-label={`Section title ${index + 1}`}
                  />
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      aria-label="Move section up"
                      disabled={index === 0}
                      onClick={() => onMove(s.id, "up")}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="Move section down"
                      disabled={index === sections.length - 1}
                      onClick={() => onMove(s.id, "down")}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete section"
                    disabled={sections.length <= 1}
                    onClick={() => onDelete(s.id)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  className={`w-full truncate px-2.5 py-1.5 text-left text-sm ${
                    selected ? "font-semibold text-foreground" : "text-foreground/80"
                  }`}
                >
                  {s.title}
                </button>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function SectionReadPanel({ section }: { section: SectionData }) {
  const emptyBody = isEmptyDoc(section.body);
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-heading text-base font-semibold text-foreground">{section.title}</h3>
      {section.videoUrl && (
        <video src={section.videoUrl} controls className="w-full rounded-lg bg-black" />
      )}
      {emptyBody ? (
        <p className={EMPTY_CLASS}>No guide written for this section yet.</p>
      ) : (
        <RichTextViewer content={section.body} enableMentions />
      )}
    </div>
  );
}

function SectionEditPanel({
  section,
  uploading,
  onUploading,
  onChange,
}: {
  section: DraftSection;
  uploading: boolean;
  onUploading: (v: boolean) => void;
  onChange: (patch: Partial<DraftSection>) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onUploading(true);
    setError(null);
    try {
      const { s3Key } = await uploadFileToS3(file, "page-docs", "video/*");
      onChange({
        videoKeyChange: s3Key,
        videoLabel: file.name,
        hasVideo: true,
        videoUrl: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      onUploading(false);
    }
  }

  const showingVideo =
    section.videoKeyChange === null
      ? false
      : section.videoKeyChange !== undefined
        ? true
        : section.hasVideo;

  return (
    <div className="flex flex-col gap-4">
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
            {showingVideo ? "Replace video" : "Upload video"}
          </button>
          {showingVideo && (
            <>
              <span className="text-xs text-muted-foreground">
                {section.videoLabel ?? "Current video"}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    videoKeyChange: null,
                    videoLabel: null,
                    hasVideo: false,
                    videoUrl: null,
                  })
                }
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
        <span className="text-xs text-muted-foreground">Up to {MAX_UPLOAD_LABEL}</span>
        {section.videoUrl && section.videoKeyChange === undefined && (
          <video src={section.videoUrl} controls className="mt-1 w-full rounded-lg bg-black" />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL_CLASS}>Guide</span>
        <RichTextEditor
          key={section.id}
          value={section.body}
          onChange={(body) => onChange({ body })}
          enableMentions
          richToolbar
          placeholder="Explain this section of the page."
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
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
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
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
