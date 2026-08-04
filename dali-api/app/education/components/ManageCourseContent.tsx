import { useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import { FileText, Folder, Users } from "lucide-react";
import { AddFormModal } from "./AddFormModal";
import { Button, buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { toDatetimeLocal } from "./OfferingFields";
import { DateField } from "~/components/ui/DateField";

// Manager-side course content tabs: Materials (offering-workspace pages),
// Assignments (CRUD + inline collab instructions), Announcements (composer).
// All mutations post intents to the manage route's action.

const INPUT =
  "mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm";
const LABEL = "text-xs font-semibold text-muted-foreground";

export function ManageMaterials({
  materials,
  workspaceDocs,
}: {
  materials: {
    id: string;
    title: string;
    isFolder: boolean;
    children: { id: string; title: string }[];
  }[];
  workspaceDocs: { id: string; title: string }[];
}) {
  const [addPageOpen, setAddPageOpen] = useState(false);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [addDocOpen, setAddDocOpen] = useState(false);
  const folders = materials.filter((m) => m.isFolder);

  // Drag a material onto a folder to nest it, or onto the top-level strip to
  // pull it back out. Folders don't move — they're always top-level.
  const moveFetcher = useFetcher();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);

  function move(pageId: string, parentPageId: string | null) {
    setDragId(null);
    setDropTarget(null);
    moveFetcher.submit(
      { intent: "move-page", pageId, parentPageId: parentPageId ?? "" },
      { method: "post" },
    );
  }

  const dropProps = (target: string | "root") => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
    onDrop: (e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      move(dragId, target === "root" ? null : target);
    },
  });

  const dragProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    },
    onDragEnd: () => {
      setDragId(null);
      setDropTarget(null);
    },
  });
  const empty = materials.length === 0 && workspaceDocs.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          Materials are read-only for students; shared docs are co-edited live. Drag a material
          onto a folder to file it.
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => setAddPageOpen(true)}>
            Add material
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setAddFolderOpen(true)}
          >
            Add folder
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setAddDocOpen(true)}>
            Add shared doc
          </Button>
        </div>
      </div>

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
              {...(p.isFolder ? dropProps(p.id) : dragProps(p.id))}
              className={`px-4 py-3 ${p.isFolder ? "" : "cursor-grab active:cursor-grabbing"} ${
                dragId === p.id ? "opacity-50" : ""
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
                <DocRow id={p.id} title={p.title} kind="material" />
              )}
              {p.children.length > 0 && (
                <ul className="mt-2 ml-6 flex flex-col gap-1.5">
                  {p.children.map((c) => (
                    <li
                      key={c.id}
                      {...dragProps(c.id)}
                      className={`cursor-grab active:cursor-grabbing ${
                        dragId === c.id ? "opacity-50" : ""
                      }`}
                    >
                      <DocRow id={c.id} title={c.title} kind="material" nested />
                    </li>
                  ))}
                </ul>
              )}
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
        <label className="block">
          <span className={LABEL}>Folder (optional)</span>
          <select name="parentPageId" className={INPUT} defaultValue="">
            <option value="">Top level</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
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
}: {
  id: string;
  title: string;
  kind: "material" | "shared";
  nested?: boolean;
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
    </div>
  );
}


export type ManageAssignment = {
  id: string;
  title: string;
  dueAt: string | Date | null;
  submissionType: "Text" | "File" | "Mixed";
  instructionsDocId: string | null;
  sessionId: string | null;
  sessionSequence: number | null;
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
            <Form method="post" className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] items-end">
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
                <select name="submissionType" defaultValue={a.submissionType} className={INPUT}>
                  <option value="Text">Text</option>
                  <option value="File">File</option>
                  <option value="Mixed">Text + files</option>
                </select>
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
            <select name="submissionType" defaultValue="Mixed" className={INPUT}>
              <option value="Text">Text</option>
              <option value="File">File</option>
              <option value="Mixed">Text + files</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className={LABEL}>Session (optional)</span>
          <select name="sessionId" defaultValue="" className={INPUT}>
            <option value="">Whole offering</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                Session {s.sequence}
              </option>
            ))}
          </select>
        </label>
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
