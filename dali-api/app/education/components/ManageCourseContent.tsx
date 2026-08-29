import { useRef, useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import { FileText, Folder, Paperclip, Users, Plus, ChevronDown, Upload } from "lucide-react";
import { Select, type SelectOption, Menu } from "~/components/ui/floating";
import { AddFormModal } from "./AddFormModal";
import { Button, buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { toDatetimeLocal } from "./OfferingFields";
import { DateField } from "~/components/ui/DateField";
import { FavoriteStar } from "~/components/FavoriteStar";
import { uploadFileToS3 } from "~/lib/upload-client";

// Manager-side course content tabs: Materials (offering-workspace pages),
// Assignments (CRUD + inline collab instructions), Announcements (composer).
// All mutations post intents to the manage route's action.

const INPUT =
  "mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm";
const LABEL = "text-xs font-semibold text-muted-foreground";

export function ManageMaterials({
  offeringId,
  materials,
  files = [],
  workspaceDocs,
  sessions = [],
  favoriteIds = [],
}: {
  offeringId: string;
  materials: {
    id: string;
    title: string;
    isFolder: boolean;
    /** Session this material is linked to (null = offering-wide). */
    sessionId: string | null;
    children: { id: string; title: string; sessionId: string | null }[];
  }[];
  /** Uploaded S3-backed files for this offering. folderPageId nests them under
   *  a materials folder (a Page id); null/unmatched = the offering root. */
  files?: { id: string; title: string; href: string; folderPageId: string | null }[];
  workspaceDocs: { id: string; title: string }[];
  sessions?: { id: string; sequence: number }[];
  /** Page ids the viewer has starred, for the per-row favorite toggle. */
  favoriteIds?: string[];
}) {
  const [addPageOpen, setAddPageOpen] = useState(false);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [addDocOpen, setAddDocOpen] = useState(false);
  const favorites = new Set(favoriteIds);
  const folders = materials.filter((m) => m.isFolder);

  // File upload: hidden input triggered by the "Upload file" button.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const meta = await uploadFileToS3(file, `offering/${offeringId}/materials`);
      const res = await fetch(`/api/education/${offeringId}/files`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: file.name, ...meta }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to register file");
      }
      // Reload the page so the new file appears in the list.
      window.location.reload();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      // Reset so the same file can be re-selected if needed.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Drag a material (a page) or an uploaded file onto a folder to file it, or
  // onto the top-level strip to pull it back out. Folders don't move — they're
  // always top-level. The dragged item carries its kind so the drop posts the
  // right intent (pages reparent via parentPageId, files via folderPageId).
  const moveFetcher = useFetcher();
  // Session-change fetcher for per-row session select.
  const sessionFetcher = useFetcher();
  const [dragged, setDragged] = useState<{ id: string; kind: "page" | "file" } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);

  function move(item: { id: string; kind: "page" | "file" }, target: string | null) {
    setDragged(null);
    setDropTarget(null);
    moveFetcher.submit(
      item.kind === "file"
        ? { intent: "move-file", fileId: item.id, folderId: target ?? "" }
        : { intent: "move-page", pageId: item.id, parentPageId: target ?? "" },
      { method: "post" },
    );
  }

  const dropProps = (target: string | "root") => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragged) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
    onDrop: (e: React.DragEvent) => {
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
      move(dragged, target === "root" ? null : target);
    },
  });

  const dragProps = (id: string, kind: "page" | "file") => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragged({ id, kind });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    },
    onDragEnd: () => {
      setDragged(null);
      setDropTarget(null);
    },
  });
  const empty = materials.length === 0 && workspaceDocs.length === 0 && files.length === 0;

  const sessionOptions: SelectOption[] = [
    { value: "", label: "Whole offering" },
    ...sessions.map((s) => ({ value: s.id, label: `Session ${s.sequence}` })),
  ];

  // Split uploaded files into ones filed inside a materials folder and loose
  // ones at the offering root, so a PDF dragged into a folder renders there.
  const folderIds = new Set(folders.map((f) => f.id));
  const filesByFolder = new Map<string, typeof files>();
  const rootFiles: typeof files = [];
  for (const f of files) {
    if (f.folderPageId && folderIds.has(f.folderPageId)) {
      const list = filesByFolder.get(f.folderPageId) ?? [];
      list.push(f);
      filesByFolder.set(f.folderPageId, list);
    } else {
      rootFiles.push(f);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          Materials are read-only for students; shared docs are co-edited live. Drag a material or
          uploaded file onto a folder to file it.
        </p>
        <div className="ml-auto flex items-center gap-2">
          {/* Hidden file input; triggered by the Upload file menu item. */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            aria-hidden
          />
          {/* New ▾ menu — mirrors the unified Drive's create affordance, since
              offering materials live in Drive. */}
          <Menu
            align="right"
            ariaLabel="New material"
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md bg-accent-coral px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-coral/90 transition-colors shrink-0"
              >
                <Plus className="w-4 h-4" /> New
                <ChevronDown className="w-3.5 h-3.5 opacity-80" />
              </button>
            }
          >
            <Menu.Item
              icon={<FileText className="w-3.5 h-3.5" />}
              onSelect={() => setAddPageOpen(true)}
            >
              New material
            </Menu.Item>
            <Menu.Item
              icon={<Folder className="w-3.5 h-3.5" />}
              onSelect={() => setAddFolderOpen(true)}
            >
              New folder
            </Menu.Item>
            <Menu.Item
              icon={<Users className="w-3.5 h-3.5" />}
              onSelect={() => setAddDocOpen(true)}
            >
              Add shared doc
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              icon={<Upload className="w-3.5 h-3.5" />}
              disabled={uploading}
              onSelect={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload file"}
            </Menu.Item>
          </Menu>
        </div>
      </div>
      {uploadError && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {uploadError}
        </p>
      )}

      {empty ? (
        <p className="text-sm text-muted-foreground italic">
          Nothing here yet. Materials show under the course hub's Materials tab; shared docs
          under Workspace.
        </p>
      ) : (
        // One list, because that's how students meet them — the badge and icon
        // carry the difference rather than two separate sections.
        <ul
          {...dropProps("root")}
          className={`rounded-lg border bg-card divide-y divide-border ${
            dropTarget === "root" ? "border-accent-coral" : "border-border"
          }`}
        >
          {materials.map((p) => (
            <li
              key={p.id}
              {...(p.isFolder ? dropProps(p.id) : dragProps(p.id, "page"))}
              className={`px-4 py-3 ${p.isFolder ? "" : "cursor-grab active:cursor-grabbing"} ${
                dragged?.id === p.id ? "opacity-50" : ""
              } ${dropTarget === p.id ? "bg-accent-coral/10" : ""}`}
            >
              {p.isFolder ? (
                // A folder is a container, so it gets no link — only the
                // materials inside it open.
                <div className="flex items-center gap-2">
                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-sm font-medium text-foreground">{p.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.children.length} {p.children.length === 1 ? "item" : "items"}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <DocRow id={p.id} title={p.title} kind="material" favorited={favorites.has(p.id)} />
                  {sessions.length > 0 && (
                    <SessionSelect
                      pageId={p.id}
                      sessionId={p.sessionId}
                      options={sessionOptions}
                      onSubmit={(pageId, sessionId) =>
                        sessionFetcher.submit(
                          { intent: "set-material-session", pageId, sessionId },
                          { method: "post" },
                        )
                      }
                    />
                  )}
                </div>
              )}
              {(p.children.length > 0 || (filesByFolder.get(p.id)?.length ?? 0) > 0) && (
                <ul className="mt-2 ml-6 flex flex-col gap-1.5">
                  {p.children.map((c) => (
                    <li
                      key={c.id}
                      {...dragProps(c.id, "page")}
                      className={`cursor-grab active:cursor-grabbing ${
                        dragged?.id === c.id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <DocRow id={c.id} title={c.title} kind="material" nested favorited={favorites.has(c.id)} />
                        {sessions.length > 0 && (
                          <SessionSelect
                            pageId={c.id}
                            sessionId={c.sessionId}
                            options={sessionOptions}
                            onSubmit={(pageId, sessionId) =>
                              sessionFetcher.submit(
                                { intent: "set-material-session", pageId, sessionId },
                                { method: "post" },
                              )
                            }
                          />
                        )}
                      </div>
                    </li>
                  ))}
                  {(filesByFolder.get(p.id) ?? []).map((f) => (
                    <li
                      key={f.id}
                      {...dragProps(f.id, "file")}
                      className={`cursor-grab active:cursor-grabbing ${
                        dragged?.id === f.id ? "opacity-50" : ""
                      }`}
                    >
                      <FileRow href={f.href} title={f.title} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {/* Loose uploaded files (S3-backed) at the offering root — draggable
              into any folder above. Files filed inside a folder render nested. */}
          {rootFiles.map((f) => (
            <li
              key={f.id}
              {...dragProps(f.id, "file")}
              className={`px-4 py-3 cursor-grab active:cursor-grabbing ${
                dragged?.id === f.id ? "opacity-50" : ""
              }`}
            >
              <FileRow href={f.href} title={f.title} />
            </li>
          ))}
          {workspaceDocs.map((d) => (
            <li key={d.id} className="px-4 py-3">
              <DocRow id={d.id} title={d.title} kind="shared" />
            </li>
          ))}
        </ul>
      )}

      <AddFormModal
        open={addPageOpen}
        onClose={() => setAddPageOpen(false)}
        title="Add material"
        subtitle="A read-only page students see under Materials."
        intent="create-page"
        submitLabel="Add material"
      >
        <label className="block">
          <span className={LABEL}>Title</span>
          <input
            type="text"
            name="title"
            required
            placeholder="Session 1 — Slides & notes"
            className={INPUT}
          />
        </label>
        {sessions.length > 0 && (
          <label className="block">
            <span className={LABEL}>Session (optional)</span>
            <Select
              name="sessionId"
              defaultValue=""
              placeholder="Whole offering"
              options={sessionOptions}
              buttonClassName={INPUT}
            />
          </label>
        )}
        <label className="block">
          <span className={LABEL}>Folder (optional)</span>
          <Select
            name="parentPageId"
            defaultValue=""
            placeholder="Top level"
            options={[
              { value: "", label: "Top level" },
              ...folders.map((f) => ({ value: f.id, label: f.title })),
            ]}
            buttonClassName={INPUT}
          />
        </label>
      </AddFormModal>

      <AddFormModal
        open={addFolderOpen}
        onClose={() => setAddFolderOpen(false)}
        title="Add folder"
        subtitle="Groups materials. A folder isn't a page students can open."
        intent="create-page"
        submitLabel="Add folder"
        hiddenFields={{ kind: "Folder" }}
      >
        <label className="block">
          <span className={LABEL}>Folder name</span>
          <input
            type="text"
            name="title"
            required
            placeholder="Week 1"
            className={INPUT}
          />
        </label>
      </AddFormModal>

      <AddFormModal
        open={addDocOpen}
        onClose={() => setAddDocOpen(false)}
        title="Add shared doc"
        subtitle="Enrolled students can co-edit this one live."
        intent="create-page"
        submitLabel="Add shared doc"
        hiddenFields={{ studentEditable: "true" }}
      >
        <label className="block">
          <span className={LABEL}>Title</span>
          <input
            type="text"
            name="title"
            required
            placeholder="Workshop scratchpad"
            className={INPUT}
          />
        </label>
      </AddFormModal>
    </div>
  );
}

/** Controlled session-assignment picker for a single material row. Auto-submits
 *  on change so the manager doesn't need a separate save button. */
function SessionSelect({
  pageId,
  sessionId,
  options,
  onSubmit,
}: {
  pageId: string;
  sessionId: string | null;
  options: SelectOption[];
  onSubmit: (pageId: string, sessionId: string) => void;
}) {
  const [value, setValue] = useState(sessionId ?? "");
  return (
    <Select
      value={value}
      options={options}
      onChange={(v) => {
        setValue(v);
        onSubmit(pageId, v);
      }}
      buttonClassName="text-xs py-0.5 px-2 border border-border rounded min-w-[110px]"
      ariaLabel="Assign to session"
    />
  );
}

/** An uploaded file in the materials list — opens via its Drive file viewer. */
function FileRow({ href, title }: { href: string; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate text-sm font-medium text-foreground hover:text-accent-coral"
      >
        {title}
      </a>
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        File
      </span>
    </div>
  );
}

/**
 * One document in the materials list. The title is the link — clicking the name
 * is how you open a document everywhere else in the app, and making Edit the
 * only target meant aiming at a button to read a page.
 */
function DocRow({
  id,
  title,
  kind,
  nested = false,
  favorited = false,
}: {
  id: string;
  title: string;
  kind: "material" | "shared";
  nested?: boolean;
  favorited?: boolean;
}) {
  const shared = kind === "shared";
  const Icon = shared ? Users : FileText;
  return (
    <div className="flex items-center justify-between gap-3">
      <Link
        to={`/documents/${id}`}
        className="group flex min-w-0 items-center gap-2 text-left"
      >
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${shared ? "text-accent-teal" : "text-muted-foreground"}`}
          aria-hidden
        />
        <span
          className={`truncate group-hover:text-accent-coral ${
            nested ? "text-sm text-muted-foreground" : "text-sm font-medium text-foreground"
          }`}
        >
          {title}
        </span>
        {shared && (
          <span className="shrink-0 rounded-full bg-accent-teal/10 px-2 py-0.5 text-[10px] font-semibold text-accent-teal">
            Shared
          </span>
        )}
      </Link>
      <FavoriteStar pageId={id} favorited={favorited} />
    </div>
  );
}


export type ManageAssignment = {
  id: string;
  title: string;
  dueAt: string | Date | null;
  submissionType: "Text" | "File" | "Mixed" | "Link" | "Doc" | "Complete";
  instructionsDocId: string | null;
  sessionId: string | null;
  sessionSequence: number | null;
  /** Null = complete/incomplete; non-null = numeric grading out of this many points. */
  points: number | null;
  _count: { submissions: number };
};

export function ManageAssignments({
  assignments,
  sessions,
  collabToken,
  userName,
}: {
  assignments: ManageAssignment[];
  sessions: { id: string; sequence: number }[];
  collabToken: string | null;
  userName: string;
}) {
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
          Add assignment
        </Button>
      </div>
      {assignments.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          No assignments yet — enrolled students see these under the Assignments tab of the
          course hub.
        </p>
      )}
      {assignments.map((a) => (
        <details key={a.id} className="bg-card border border-border rounded-lg px-4 py-3">
          <summary className="flex items-center justify-between gap-4 cursor-pointer list-none">
            <div>
              <span className="text-sm font-semibold text-foreground">{a.title}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {a.sessionSequence != null && `Session ${a.sessionSequence} · `}
                {a.dueAt ? `Due ${formatDateTime(a.dueAt, tz)}` : "No due date"}
              </span>
            </div>
            <Link
              to={`/education/manage/assignments/${a.id}`}
              className={buttonClasses("secondary", "sm")}
            >
              Submissions ({a._count.submissions})
            </Link>
          </summary>

          <div className="mt-3 pt-3 border-t border-border flex flex-col gap-4">
            <Form method="post" className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_20ch_auto] items-end">
              <input type="hidden" name="intent" value="update-assignment" />
              <input type="hidden" name="assignmentId" value={a.id} />
              <label className="block">
                <span className={LABEL}>Title</span>
                <input type="text" name="title" required defaultValue={a.title} className={INPUT} />
              </label>
              <label className="block">
                <span className={LABEL}>Due</span>
                <DateField
                  mode="datetime-local"
                  name="dueAt"
                  defaultValue={a.dueAt ? toDatetimeLocal(a.dueAt) : ""}
                  className="w-full"
                  ariaLabel="Due"
                />
              </label>
              <label className="block">
                <span className={LABEL}>Type</span>
                <Select
                  name="submissionType"
                  defaultValue={a.submissionType}
                  options={[
                    { value: "Text", label: "Text" },
                    { value: "File", label: "File" },
                    { value: "Mixed", label: "Text + files" },
                    { value: "Link", label: "Link / URL" },
                    { value: "Doc", label: "Document (in-app)" },
                    { value: "Complete", label: "Mark complete only" },
                  ]}
                  buttonClassName={INPUT}
                />
              </label>
              <label className="block">
                <span className={LABEL}>Points (optional)</span>
                <input
                  type="number"
                  name="points"
                  min={1}
                  defaultValue={a.points ?? ""}
                  placeholder="—"
                  className={INPUT}
                />
              </label>
              <div className="flex justify-end">
                <Button type="submit" variant="secondary" size="sm">
                  Save
                </Button>
              </div>
            </Form>

            <div>
              <p className={LABEL}>Instructions (live-edited, students see a read-only copy)</p>
              {collabToken && a.instructionsDocId ? (
                <PresenceProvider
                  pageId={`eduassignment:${a.id}`}
                  token={collabToken}
                  userName={userName}
                >
                  <DocEditor
                    features="notes"
                    aiEnabled
                    collab={{
                      documentName: a.instructionsDocId,
                      token: collabToken,
                      userName,
                    }}
                    placeholder="What students should build or hand in…"
                    className="mt-1 border border-border rounded-md"
                  />
                </PresenceProvider>
              ) : (
                <p className="text-xs text-muted-foreground italic mt-1">
                  Sign in again to edit instructions.
                </p>
              )}
            </div>

            {a._count.submissions === 0 && (
              <Form
                method="post"
                onSubmit={confirmSubmit({
                  title: "Delete this assignment?",
                  confirmLabel: "Delete",
                  tone: "destructive",
                })}
              >
                <input type="hidden" name="intent" value="delete-assignment" />
                <input type="hidden" name="assignmentId" value={a.id} />
                <Button type="submit" variant="ghost" size="sm">
                  Delete assignment
                </Button>
              </Form>
            )}
          </div>
        </details>
      ))}

      <AddFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add assignment"
        intent="create-assignment"
        submitLabel="Add assignment"
      >
        <label className="block">
          <span className={LABEL}>Title</span>
          <input type="text" name="title" required placeholder="Build a landing page" className={INPUT} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Due (optional)</span>
            <DateField mode="datetime-local" name="dueAt" className="w-full" ariaLabel="Due (optional)" />
          </label>
          <label className="block">
            <span className={LABEL}>Type</span>
            <Select
              name="submissionType"
              defaultValue="Mixed"
              options={[
                { value: "Text", label: "Text" },
                { value: "File", label: "File" },
                { value: "Mixed", label: "Text + files" },
                { value: "Link", label: "Link / URL" },
                { value: "Doc", label: "Document (in-app)" },
                { value: "Complete", label: "Mark complete only" },
              ]}
              buttonClassName={INPUT}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Session (optional)</span>
            <Select
              name="sessionId"
              defaultValue=""
              placeholder="Whole offering"
              options={[
                { value: "", label: "Whole offering" },
                ...sessions.map((s) => ({ value: s.id, label: `Session ${s.sequence}` })),
              ]}
              buttonClassName={INPUT}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Points (optional)</span>
            <input
              type="number"
              name="points"
              min={1}
              placeholder="Leave blank for complete/incomplete"
              className={INPUT}
            />
          </label>
        </div>
      </AddFormModal>
    </div>
  );
}

export function ManageAnnouncements({
  announcements,
}: {
  announcements: { id: string; body: string; sentAt: string | Date; authorName: string }[];
}) {
  const tz = useUserTimeZone();
  const [composeOpen, setComposeOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => setComposeOpen(true)}>
          New announcement
        </Button>
      </div>

      <AddFormModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title="New announcement"
        subtitle="Goes to every approved enrollee — in-app and by email."
        intent="post-announcement"
        submitLabel="Send announcement"
      >
        <label className="block">
          <span className={LABEL}>Message</span>
          <textarea
            name="body"
            required
            rows={4}
            placeholder="Reminder: bring your laptops tomorrow…"
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </label>
      </AddFormModal>

      {announcements.map((a) => (
        <div key={a.id} className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">
            {a.authorName} · {formatDateTime(a.sentAt, tz)}
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap mt-1">{a.body}</p>
        </div>
      ))}
      {announcements.length === 0 && (
        <p className="text-sm text-muted-foreground italic">Nothing sent yet.</p>
      )}
    </div>
  );
}
