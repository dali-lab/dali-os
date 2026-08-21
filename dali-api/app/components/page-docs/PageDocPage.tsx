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
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { CommentsRail } from "~/components/collab/CommentsRail";
import { buttonClasses } from "~/components/ui/Button";
import { uploadFileToS3 } from "~/lib/upload-client";
import { MAX_UPLOAD_LABEL } from "~/lib/file-validation";
// PageDocPage is lazy-loaded (see PageDocContext), so importing from the doc
// schema package here doesn't drag BlockNote into any route's initial chunk.
import { searchMentionableUsers, type MentionUser } from "~/components/doc/schema/mention";
import { Tooltip } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";
import { useFeatureFlag } from "~/components/FeatureFlags";

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
// The dali.os eyebrow: wider tracking on the design's secondary grey, as on the
// project page's section labels.
const OS_SECTION_LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-widest text-os-grey";
const EMPTY_CLASS = "py-2 text-sm text-muted-foreground";

const TITLE_ID = "page-doc-page-title";

function useOsLabelClass() {
  return useFeatureFlag("os-redesign") ? OS_SECTION_LABEL_CLASS : SECTION_LABEL_CLASS;
}

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
  // Under the dali.os shell the guide wears that design instead of the brand
  // shell's: a large light title, pill buttons on the pale-blue accent, and the
  // rail's own active-row marker on the section list. Content is untouched.
  const os = useFeatureFlag("os-redesign");
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
            className={cn(
              "disabled:opacity-50",
              os
                ? "os-btn-ghost"
                : "px-2.5 py-1 text-sm rounded-md text-foreground/80 hover:bg-muted",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || uploading || !draftTitle.trim()}
            className={cn(
              os ? "os-btn-primary" : buttonClasses("primary", "sm"),
              "disabled:opacity-50",
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      ) : os ? (
        // The design labels its secondary actions rather than reducing them to
        // a bare glyph, so the pill carries the word and needs no tooltip.
        <button type="button" onClick={startEditing} className="os-edit-btn os-add-btn--sm">
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
        </button>
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
    <div
      className={cn("flex min-h-[70vh] flex-col", os ? "gap-8" : "gap-5")}
      aria-labelledby={TITLE_ID}
    >
      <header
        className={cn(
          "flex items-start justify-between gap-4",
          // The os pages separate the title from the page with space, not a
          // rule — the only rules that design draws are structural (the rail
          // divider, the tab bar).
          os ? "pb-1" : "border-b border-border pb-4",
        )}
      >
        <div className="min-w-0 flex-1">
          {/* The input lives inside the h1 so the heading — and the
              aria-labelledby that points at it — survives edit mode; a text
              input's value carries into the accessible name. */}
          <h1
            id={TITLE_ID}
            className={cn(
              "font-heading text-foreground",
              os ? "text-4xl font-medium" : "text-xl font-bold sm:text-2xl",
            )}
          >
            {editing ? (
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder={fallbackTitle}
                aria-label="Guide title"
                className={cn(
                  "w-full border border-transparent bg-transparent px-1.5 py-0.5 -ml-1.5 font-heading text-foreground hover:border-border focus:border-border focus:bg-background focus:outline-none focus:ring-2",
                  os
                    ? "rounded-os-item text-4xl font-medium focus:ring-os-accent/40"
                    : "rounded-md text-xl font-bold focus:ring-accent-coral/30 sm:text-2xl",
                )}
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
            <p
              className={cn(
                "text-muted-foreground",
                os ? "mt-2 text-sm" : "mt-0.5 text-xs",
              )}
            >
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
            className={
              os
                ? "flex h-10 w-10 items-center justify-center rounded-os-item text-os-grey transition-colors hover:bg-os-container hover:text-white"
                : "text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
            }
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
        <div className={cn("flex flex-col", os ? "gap-8" : "gap-5")}>
          <div
            className={cn(
              "flex flex-col sm:flex-row sm:items-start",
              os ? "gap-6" : "gap-4",
            )}
          >
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

            <div className={cn("min-w-0 flex-1 flex flex-col", os ? "gap-6" : "gap-4")}>
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

          <section
            className={cn(
              "flex flex-col gap-2 border-t border-border",
              os ? "pt-8" : "pt-5",
            )}
          >
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
  const os = useFeatureFlag("os-redesign");
  const labelClass = useOsLabelClass();
  return (
    <aside
      className={cn(
        "w-full shrink-0 sm:border-r sm:border-border",
        os ? "sm:w-60 sm:pr-5" : "sm:w-52 sm:pr-4",
      )}
    >
      <div className={cn("flex items-center justify-between gap-2", os ? "mb-3" : "mb-2")}>
        <h3 className={labelClass}>Sections</h3>
        {editing && (
          <button
            type="button"
            onClick={onAdd}
            className={
              os
                ? "os-add-btn os-add-btn--sm"
                : "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-foreground hover:bg-muted"
            }
          >
            <Plus
              className={os ? "h-3 w-3" : "h-3.5 w-3.5"}
              strokeWidth={os ? 3 : undefined}
              aria-hidden
            />
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
              // Selection follows whichever shell this is in: the brand shell's
              // active-nav convention (accent-coral edge + text, as in
              // AreaPillNav) rather than a muted tint, which was too faint to
              // read as selected in light mode; under dali.os, the sidebar's own
              // marker (.os-subtab-active) — a filled well whose left border is
              // the accent stripe. Either way the unselected rows carry a
              // transparent edge of the same width, so the labels stay aligned.
              className={cn(
                "group flex min-w-[8rem] flex-col gap-1 sm:min-w-0",
                os
                  ? selected
                    ? "os-subtab-active"
                    : "rounded-os-item border-l-2 border-transparent hover:bg-white/[0.03]"
                  : cn(
                      "rounded-md border-l-2",
                      selected
                        ? "border-accent-coral bg-accent-coral/10"
                        : "border-transparent hover:bg-muted/40",
                    ),
              )}
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
                  className={cn(
                    "w-full truncate text-left",
                    os ? "px-3 py-2 text-base" : "px-2.5 py-1.5 text-sm",
                    os
                      ? selected
                        ? "font-medium text-white"
                        : "text-os-grey hover:text-white"
                      : selected
                        ? "font-semibold text-accent-coral"
                        : "text-foreground/80",
                  )}
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
  const os = useFeatureFlag("os-redesign");
  const emptyBody = isEmptyBlocks(section.body);
  return (
    <div className="flex flex-col gap-4">
      {/* One step below the guide's own h1, so the section you're reading is
          legible as the heading of this pane rather than sitting at body
          size. */}
      <h3
        className={cn(
          "font-heading text-foreground",
          os ? "text-2xl font-medium" : "text-lg font-bold sm:text-xl",
        )}
      >
        {section.title}
      </h3>
      {section.videoUrl && (
        <video
          src={section.videoUrl}
          controls
          className={cn("w-full bg-black", os ? "rounded-os-card" : "rounded-lg")}
        />
      )}
      {emptyBody ? (
        <p className={EMPTY_CLASS}>No guide written for this section yet.</p>
      ) : (
        // Keyed per section: DocEditor reads initialContent once, so switching
        // sections must remount it. "guide" = mentions + images.
        <DocEditor
          key={section.id}
          features="guide"
          density="compact"
          editable={false}
          initialContent={section.body}
        />
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
  const os = useFeatureFlag("os-redesign");
  const labelClass = useOsLabelClass();
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
        <span className={labelClass}>Walkthrough video</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className={cn(
              "disabled:opacity-50",
              os
                ? "os-edit-btn"
                : "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50",
            )}
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
          <video
            src={section.videoUrl}
            controls
            className={cn("mt-1 w-full bg-black", os ? "rounded-os-card" : "rounded-lg")}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Guide</span>
        {/* Section bodies save as BlockNote block JSON (the API converts
            legacy ProseMirror on read, so initialContent is always blocks). */}
        <DocEditor
          key={section.id}
          features="guide"
          aiEnabled
          initialContent={section.body}
          onChange={(body) => onChange({ body })}
          placeholder="Explain this section of the page."
          className={cn(
            "py-2",
            os
              ? "rounded-os-card bg-os-card"
              : "rounded-md border border-border bg-card",
          )}
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
  const os = useFeatureFlag("os-redesign");
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
          className={cn(
            "flex-1 border border-border text-sm text-foreground focus:outline-none focus:ring-2",
            os
              ? "rounded-full bg-os-card px-4 py-2 focus:ring-os-accent/40"
              : "rounded-md bg-background px-3 py-1.5 focus:ring-accent-coral/30",
          )}
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
