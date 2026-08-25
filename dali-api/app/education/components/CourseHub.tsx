import { Link, Form, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { Button, buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { formatDateTime } from "~/lib/display";
// Aliased: this file already has a DiscussionPost for the assignment threads.
import {
  OfferingDiscussion,
  type DiscussionPost as OfferingDiscussionPost,
} from "./OfferingDiscussion";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { cn } from "~/lib/cn";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { Avatar } from "~/components/ui/Avatar";
import { ChevronRight, FileText, Folder } from "lucide-react";

// The enrolled course hub, shared by the member surface and the portal
// mirror. `basePath` decides where page/assignment links land
// (/education/:id vs /portal/education/:id); posting to discussions goes to
// the surrounding route's action.

export type HubData = {
  offering: { id: string; title: string; descriptionHtml: string };
  instructors: { id: string; name: string; photoUrl: string | null }[];
  classmates: { id: string; name: string; photoUrl: string | null; isMe: boolean }[];
  announcements: OfferingDiscussionPost[];
  sessions: {
    id: string;
    sequence: number;
    title: string | null;
    datetime: string | Date;
    location: string | null;
    recordingUrl: string | null;
    myAttendance: "Present" | "Absent" | "Excused" | null;
  }[];
  materials: {
    id: string;
    title: string;
    isFolder: boolean;
    sessionId: string | null;
    children: { id: string; title: string; sessionId: string | null }[];
  }[];
  workspaceDocs: { id: string; title: string }[];
  assignments: {
    id: string;
    title: string;
    dueAt: string | Date | null;
    sessionSequence: number | null;
    mySubmittedAt: string | Date | null;
  }[];
  threads: DiscussionPost[];
  myFeedback: {
    feedback: string;
    updatedAt: string | Date | null;
    authorName: string | null;
  } | null;
  myCertificateId: string | null;
  currentUserId: string;
  currentUserName: string;
  isManager: boolean;
};

type DiscussionPost = {
  id: string;
  body: string;
  createdAt: string | Date;
  authorId: string;
  authorName: string;
  isInstructor: boolean;
  replies?: DiscussionPost[];
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "sessions", label: "Sessions" },
  { key: "materials", label: "Materials" },
  { key: "assignments", label: "Assignments" },
  { key: "discussions", label: "Discussions" },
] as const;

const ATTENDANCE_STYLE: Record<string, string> = {
  Present: "bg-green-100 text-green-800",
  Absent: "bg-red-100 text-red-700",
  Excused: "bg-amber-100 text-amber-800",
};

export function CourseHub({
  data,
  basePath,
  collabToken,
}: {
  data: HubData;
  basePath: string;
  collabToken?: string | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tz = useUserTimeZone();
  const tab = searchParams.get("tab") ?? "overview";

  // Workspace tab only when the offering has shared collaborative docs. Insert
  // it after Materials so read-only materials and co-edited docs sit together.
  const tabs = data.workspaceDocs.length > 0
    ? [
        ...TABS.slice(0, 3),
        { key: "workspace", label: "Workspace" } as const,
        ...TABS.slice(3),
      ]
    : TABS;

  // Assignments awaiting this student's submission (past-due ones can't be
  // submitted anymore, so they don't count) — surfaced as a tab badge so new
  // work is visible from anywhere in the hub.
  const openAssignments = data.isManager
    ? 0
    : data.assignments.filter(
        (a) => !a.mySubmittedAt && (!a.dueAt || new Date(a.dueAt) > new Date()),
      ).length;

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSearchParams({ tab: t.key }, { preventScrollReset: true })}
            className={cn(
              "px-4 py-2 text-sm font-semibold whitespace-nowrap inline-flex items-center gap-1.5",
              tab === t.key
                ? "text-accent-coral border-b-2 border-accent-coral"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.key === "assignments" && openAssignments > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-accent-coral text-white text-[10px] font-bold min-w-4 h-4 px-1">
                {openAssignments}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="flex flex-col gap-5">
          {data.myCertificateId && (
            <section className="bg-brand-tint rounded-lg px-4 py-3 flex items-center justify-between gap-4">
              <p className="text-sm text-foreground">
                🎓 You completed this course — your certificate is ready.
              </p>
              <a
                href={`/education/certificates/${data.myCertificateId}`}
                className={buttonClasses("primary", "sm") + " shrink-0"}
              >
                View certificate
              </a>
            </section>
          )}
          {data.myFeedback && (
            <section className="bg-accent-teal/5 border border-accent-teal/30 rounded-lg p-4">
              <p className="text-xs font-semibold text-accent-teal">
                Instructor feedback
                {data.myFeedback.authorName ? ` · ${data.myFeedback.authorName}` : ""}
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap mt-1">
                {data.myFeedback.feedback}
              </p>
            </section>
          )}
          {/* About the course: what it is, who teaches it, who else is in it.
              None of this was reachable from inside the hub before — a student
              had to go back out to the listing page to read the description. */}
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              About this course
            </h2>
            {data.offering.descriptionHtml ? (
              <div
                className="prose prose-sm dark:prose-invert mt-2 max-w-none"
                dangerouslySetInnerHTML={{ __html: data.offering.descriptionHtml }}
              />
            ) : (
              <p className="mt-2 text-sm text-muted-foreground italic">
                No description yet.
              </p>
            )}

            {data.instructors.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-xs font-semibold text-muted-foreground">
                  {data.instructors.length === 1 ? "Instructor" : "Instructors"}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {data.instructors.map((i) => (
                    <li
                      key={i.id}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1"
                    >
                      <Avatar photoUrl={i.photoUrl} name={i.name} size="xs" />
                      <span className="text-sm text-foreground">{i.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.classmates.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-xs font-semibold text-muted-foreground">
                  Taking this course · {data.classmates.length}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {data.classmates.map((c) => (
                    <li
                      key={c.id}
                      className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 ${
                        c.isMe
                          ? "border-accent-coral/30 bg-accent-coral/5"
                          : "border-border bg-card"
                      }`}
                    >
                      <Avatar photoUrl={c.photoUrl} name={c.name} size="xs" />
                      <span className="text-sm text-foreground">{c.name}</span>
                      {c.isMe && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-coral">
                          You
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

        </div>
      )}

      {tab === "sessions" && (
        <ul className="bg-card border border-border rounded-lg divide-y divide-border">
          {data.sessions.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground italic">
              No sessions scheduled yet.
            </li>
          )}
          {data.sessions.map((s) => (
            <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {s.title ? `${s.sequence}. ${s.title}` : `Session ${s.sequence}`}
                  {s.myAttendance && (
                    <span
                      className={cn(
                        "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        ATTENDANCE_STYLE[s.myAttendance],
                      )}
                    >
                      {s.myAttendance}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(s.datetime, tz)}
                  {s.location ? ` · ${s.location}` : ""}
                </p>
              </div>
              {s.recordingUrl && (
                <a
                  href={s.recordingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClasses("ghost", "sm")}
                >
                  Recording
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === "materials" && (
        <MaterialsTab materials={data.materials} sessions={data.sessions} basePath={basePath} />
      )}

      {tab === "workspace" && (
        <WorkspaceTab
          docs={data.workspaceDocs}
          collabToken={collabToken ?? null}
          userName={data.currentUserName}
        />
      )}

      {tab === "assignments" && (
        <ul className="bg-card border border-border rounded-lg divide-y divide-border">
          {data.assignments.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground italic">
              No assignments yet.
            </li>
          )}
          {data.assignments.map((a) => (
            <li key={a.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <Link
                  to={`${basePath}/assignments/${a.id}`}
                  className="text-sm font-medium text-foreground hover:text-accent-coral"
                >
                  {a.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {a.sessionSequence != null && `Session ${a.sessionSequence} · `}
                  {a.dueAt ? `Due ${formatDateTime(a.dueAt, tz)}` : "No due date"}
                </p>
              </div>
              {a.mySubmittedAt ? (
                <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-[11px] font-semibold">
                  Submitted
                </span>
              ) : (
                <Link
                  to={`${basePath}/assignments/${a.id}`}
                  className={buttonClasses("secondary", "sm")}
                >
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === "discussions" && (
        <div className="flex flex-col gap-5">
          {data.announcements.length > 0 && (
            <section>
              <h2 className="mb-2 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Announcements
              </h2>
              {/* Read-only here: announcements are a broadcast from the
                  instructors. Replies and questions go in the board below. */}
              <ul className="flex flex-col gap-2">
                {data.announcements.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-lg border border-accent-coral/30 bg-accent-coral/5 p-4"
                  >
                    <p className="text-xs text-muted-foreground">
                      {a.author.firstName} {a.author.lastName} ·{" "}
                      {formatDateTime(a.sentAt as never, tz)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{a.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <DiscussionBoard
            threads={data.threads}
            currentUserId={data.currentUserId}
            isManager={data.isManager}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Student Materials tab: groups materials by session with an "All / general"
 * bucket for those not linked to a specific session. Sessions are ordered by
 * sequence; within each group the original position order is preserved.
 */
function MaterialsTab({
  materials,
  sessions,
  basePath,
}: {
  materials: HubData["materials"];
  sessions: HubData["sessions"];
  basePath: string;
}) {
  if (materials.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">No materials posted yet.</p>
    );
  }

  // Build a stable session label map (id → "Session N — title or date").
  const sessionLabel = new Map(
    sessions.map((s) => [s.id, s.title ? `Session ${s.sequence} — ${s.title}` : `Session ${s.sequence}`]),
  );

  // Partition into general (no sessionId) and per-session buckets, preserving
  // the original display order within each bucket.
  const general: HubData["materials"] = [];
  const bySession = new Map<string, HubData["materials"]>();

  for (const m of materials) {
    const sid = m.sessionId;
    if (!sid) {
      general.push(m);
    } else {
      const bucket = bySession.get(sid) ?? [];
      bucket.push(m);
      bySession.set(sid, bucket);
    }
  }

  // Sessions that have at least one material, in sequence order.
  const usedSessionIds = sessions.map((s) => s.id).filter((id) => bySession.has(id));

  // Render a flat material list (folders + their children) for a given bucket.
  function MaterialList({ items }: { items: HubData["materials"] }) {
    return (
      <ul className="flex flex-col gap-4">
        {items.map((p) => (
          <li key={p.id} className="flex flex-col gap-1.5">
            {p.isFolder ? (
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Folder className="h-3.5 w-3.5" aria-hidden />
                {p.title}
              </p>
            ) : (
              <MaterialLink to={`${basePath}/page/${p.id}`} title={p.title} />
            )}
            {p.children.length > 0 && (
              <ul className={`flex flex-col gap-1.5 ${p.isFolder ? "" : "ml-6"}`}>
                {p.children.map((c) => (
                  <li key={c.id}>
                    <MaterialLink
                      to={`${basePath}/page/${c.id}`}
                      title={c.title}
                      nested={!p.isFolder}
                    />
                  </li>
                ))}
              </ul>
            )}
            {p.isFolder && p.children.length === 0 && (
              <p className="text-sm text-muted-foreground italic">Nothing in here yet.</p>
            )}
          </li>
        ))}
      </ul>
    );
  }

  // If nothing is session-linked, skip headings and render flat.
  const hasGroups = usedSessionIds.length > 0;

  if (!hasGroups) {
    return <MaterialList items={general} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {general.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            All sessions
          </h3>
          <MaterialList items={general} />
        </section>
      )}
      {usedSessionIds.map((sid) => (
        <section key={sid}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {sessionLabel.get(sid) ?? `Session`}
          </h3>
          <MaterialList items={bySession.get(sid) ?? []} />
        </section>
      ))}
    </div>
  );
}

/** One material, rendered as a clickable resource card. */
function MaterialLink({
  to,
  title,
  nested = false,
}: {
  to: string;
  title: string;
  nested?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`group flex items-center gap-3 rounded-lg border border-border bg-card transition-colors hover:border-accent-coral/50 hover:bg-muted/40 ${
        nested ? "px-3 py-2" : "px-4 py-3"
      }`}
    >
      <span
        className={`flex shrink-0 items-center justify-center rounded-md bg-accent-coral/10 text-accent-coral ${
          nested ? "h-7 w-7" : "h-8 w-8"
        }`}
      >
        <FileText className={nested ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
      </span>
      <span
        className={`min-w-0 flex-1 truncate group-hover:text-accent-coral ${
          nested ? "text-sm text-muted-foreground" : "text-sm font-medium text-foreground"
        }`}
      >
        {title}
      </span>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-accent-coral"
        aria-hidden
      />
    </Link>
  );
}

function DiscussionBoard({
  threads,
  currentUserId,
  isManager,
}: {
  threads: DiscussionPost[];
  currentUserId: string;
  isManager: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Form method="post" className="bg-card border border-border rounded-lg p-4">
        <input type="hidden" name="intent" value="post-discussion" />
        <textarea
          name="body"
          required
          rows={3}
          placeholder="Start a discussion — questions, links, ideas…"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
        />
        <div className="mt-2">
          <Button type="submit" size="sm">
            Post
          </Button>
        </div>
      </Form>

      {threads.map((t) => (
        <div key={t.id} className="bg-card border border-border rounded-lg p-4">
          <PostBody
            post={t}
            currentUserId={currentUserId}
            isManager={isManager}
          />
          <div className="mt-3 ml-5 flex flex-col gap-3 border-l-2 border-border pl-4">
            {(t.replies ?? []).map((r) => (
              <PostBody
                key={r.id}
                post={r}
                currentUserId={currentUserId}
                isManager={isManager}
              />
            ))}
            <ReplyForm parentId={t.id} />
          </div>
        </div>
      ))}
      {threads.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          No discussions yet — start the first thread above.
        </p>
      )}
    </div>
  );
}

function PostBody({
  post,
  currentUserId,
  isManager,
}: {
  post: DiscussionPost;
  currentUserId: string;
  isManager: boolean;
}) {
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();
  return (
    <div>
      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <span className="font-semibold text-foreground">{post.authorName}</span>
        {post.isInstructor && (
          <span className="inline-flex items-center rounded-full bg-accent-teal/10 text-accent-teal px-2 py-0.5 text-[10px] font-semibold">
            Instructor
          </span>
        )}
        {formatDateTime(post.createdAt, tz)}
        {(post.authorId === currentUserId || isManager) && (
          <Form
            method="post"
            onSubmit={confirmSubmit({
              title: "Delete this post?",
              confirmLabel: "Delete",
              tone: "destructive",
            })}
          >
            <input type="hidden" name="intent" value="delete-discussion" />
            <input type="hidden" name="postId" value={post.id} />
            <button
              type="submit"
              className="text-[11px] text-muted-foreground hover:text-destructive underline"
            >
              Delete
            </button>
          </Form>
        )}
      </p>
      <p className="text-sm text-foreground whitespace-pre-wrap mt-1">{post.body}</p>
    </div>
  );
}

function ReplyForm({ parentId }: { parentId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs text-muted-foreground hover:text-foreground underline"
      >
        Reply
      </button>
    );
  }
  return (
    <Form method="post" className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="post-discussion" />
      <input type="hidden" name="parentId" value={parentId} />
      <textarea
        name="body"
        required
        rows={2}
        autoFocus
        placeholder="Write a reply…"
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="secondary">
          Reply
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Form>
  );
}

// Shared collaborative docs for the offering. Enrolled students (members and
// Dartmouth portal users) co-edit live via the same Hocuspocus room the
// instructor uses. The editor is mounted client-only (it can't render on the
// server) and re-keyed per doc so switching docs rebinds cleanly. Mentions are
// off — the mention search is member-gated, so it would be empty for portal
// students.
function WorkspaceTab({
  docs,
  collabToken,
  userName,
}: {
  docs: { id: string; title: string }[];
  collabToken: string | null;
  userName: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(docs[0]?.id ?? null);
  useEffect(() => setMounted(true), []);

  const selected = docs.find((d) => d.id === selectedId) ?? docs[0] ?? null;

  if (!collabToken) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Sign in again to open shared docs.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {docs.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {docs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelectedId(d.id)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                selected?.id === d.id
                  ? "bg-accent-coral text-white"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {d.title}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Shared doc — everyone enrolled can edit. Changes save automatically.
          </p>
          {mounted ? (
            <PresenceProvider
              pageId={`doc:${selected.id}`}
              token={collabToken}
              userName={userName}
            >
              <DocEditor
                key={selected.id}
                features="notes"
                collab={{
                  documentName: `doc:${selected.id}:body`,
                  token: collabToken,
                  userName,
                }}
                placeholder="Start writing together…"
                className="border border-border rounded-md"
              />
            </PresenceProvider>
          ) : (
            <div className="h-40 animate-pulse rounded-md border border-border bg-muted/30" />
          )}
        </div>
      )}
    </div>
  );
}
