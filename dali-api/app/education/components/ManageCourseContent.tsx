import { Form, Link } from "react-router";
import { Button, buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { toDatetimeLocal } from "./OfferingFields";

// Manager-side course content tabs: Materials (offering-workspace pages),
// Assignments (CRUD + inline collab instructions), Announcements (composer).
// All mutations post intents to the manage route's action.

const INPUT =
  "mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm";
const LABEL = "text-xs font-semibold text-muted-foreground";

export function ManageMaterials({
  materials,
}: {
  materials: { id: string; title: string; children: { id: string; title: string }[] }[];
}) {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {materials.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No material pages yet — enrolled students see these under the
          Materials tab of the course hub.
        </p>
      ) : (
        <ul className="bg-card border border-border rounded-lg divide-y divide-border">
          {materials.map((p) => (
            <li key={p.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">{p.title}</span>
                <Link to={`/documents/${p.id}`} className={buttonClasses("secondary", "sm")}>
                  Edit
                </Link>
              </div>
              {p.children.length > 0 && (
                <ul className="mt-2 ml-4 flex flex-col gap-1">
                  {p.children.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">{c.title}</span>
                      <Link
                        to={`/documents/${c.id}`}
                        className="text-xs text-accent-coral hover:underline"
                      >
                        Edit
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <Form
        method="post"
        className="bg-card border border-border rounded-lg p-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end"
      >
        <input type="hidden" name="intent" value="create-page" />
        <label className="block">
          <span className={LABEL}>New page title</span>
          <input
            type="text"
            name="title"
            required
            placeholder="Session 1 — Slides & notes"
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Nest under (optional)</span>
          <select name="parentPageId" className={INPUT} defaultValue="">
            <option value="">Top level</option>
            {materials.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm">
          Add page
        </Button>
      </Form>
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
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
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
                <input
                  type="datetime-local"
                  name="dueAt"
                  defaultValue={a.dueAt ? toDatetimeLocal(a.dueAt) : ""}
                  className={INPUT}
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
              <Button type="submit" variant="secondary" size="sm">
                Save
              </Button>
            </Form>

            <div>
              <p className={LABEL}>Instructions (live-edited, students see a read-only copy)</p>
              {collabToken && a.instructionsDocId ? (
                <PresenceProvider
                  pageId={`eduassignment:${a.id}`}
                  token={collabToken}
                  userName={userName}
                >
                  <CollaborativeEditor
                    editorId={a.instructionsDocId}
                    documentName={a.instructionsDocId}
                    token={collabToken}
                    userName={userName}
                    enableImages
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

      <Form
        method="post"
        className="bg-card border border-border rounded-lg p-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] items-end"
      >
        <input type="hidden" name="intent" value="create-assignment" />
        <label className="block">
          <span className={LABEL}>New assignment</span>
          <input type="text" name="title" required placeholder="Build a landing page" className={INPUT} />
        </label>
        <label className="block">
          <span className={LABEL}>Due (optional)</span>
          <input type="datetime-local" name="dueAt" className={INPUT} />
        </label>
        <label className="block">
          <span className={LABEL}>Type</span>
          <select name="submissionType" defaultValue="Mixed" className={INPUT}>
            <option value="Text">Text</option>
            <option value="File">File</option>
            <option value="Mixed">Text + files</option>
          </select>
        </label>
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
        <Button type="submit" size="sm">
          Add
        </Button>
      </Form>
    </div>
  );
}

export function ManageAnnouncements({
  announcements,
}: {
  announcements: { id: string; body: string; sentAt: string | Date; authorName: string }[];
}) {
  const tz = useUserTimeZone();
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Form method="post" className="bg-card border border-border rounded-lg p-4">
        <input type="hidden" name="intent" value="post-announcement" />
        <label className="block">
          <span className={LABEL}>
            New announcement — goes to every approved enrollee (in-app + email)
          </span>
          <textarea
            name="body"
            required
            rows={3}
            placeholder="Reminder: bring your laptops tomorrow…"
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </label>
        <div className="mt-2">
          <Button type="submit" size="sm">
            Send announcement
          </Button>
        </div>
      </Form>

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
