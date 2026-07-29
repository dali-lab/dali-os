import { Link, Form, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { Button, buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { cn } from "~/lib/cn";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import { PresenceProvider } from "~/components/collab/PresenceProvider";

// The enrolled course hub, shared by the member surface and the portal
// mirror. `basePath` decides where page/assignment links land
// (/education/:id vs /portal/education/:id); posting to discussions goes to
// the surrounding route's action.

export type HubData = {
  offering: { id: string; title: string; descriptionHtml: string };
  announcements: { id: string; body: string; sentAt: string | Date; authorName: string }[];
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
    children: { id: string; title: string }[];
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
        <div className="flex flex-col gap-5 max-w-3xl">
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
          {data.offering.descriptionHtml && (
            <section
              className="bg-card border border-border rounded-lg p-5 prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: data.offering.descriptionHtml }}
            />
          )}
          <section>
            <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Announcements
            </h2>
            {data.announcements.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Nothing announced yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.announcements.map((a) => (
                  <li key={a.id} className="bg-card border border-border rounded-lg p-4">
                    <p className="text-xs text-muted-foreground">
                      {a.authorName} · {formatDateTime(a.sentAt, tz)}
                    </p>
                    <p className="text-sm text-foreground whitespace-pre-wrap mt-1">
                      {a.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "sessions" && (
        <ul className="bg-card border border-border rounded-lg divide-y divide-border max-w-3xl">
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
        <div className="max-w-3xl">
          {data.materials.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No materials posted yet.
            </p>
          ) : (
            <ul className="bg-card border border-border rounded-lg divide-y divide-border">
              {data.materials.map((p) => (
                <li key={p.id} className="px-4 py-3">
                  <Link
                    to={`${basePath}/page/${p.id}`}
                    className="text-sm font-medium text-foreground hover:text-accent-coral"
                  >
                    {p.title}
                  </Link>
                  {p.children.length > 0 && (
                    <ul className="mt-1 ml-4 flex flex-col gap-1">
                      {p.children.map((c) => (
                        <li key={c.id}>
                          <Link
                            to={`${basePath}/page/${c.id}`}
                            className="text-sm text-muted-foreground hover:text-accent-coral"
                          >
                            {c.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "workspace" && (
        <WorkspaceTab
          docs={data.workspaceDocs}
          collabToken={collabToken ?? null}
          userName={data.currentUserName}
        />
      )}

      {tab === "assignments" && (
        <ul className="bg-card border border-border rounded-lg divide-y divide-border max-w-3xl">
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
        <DiscussionBoard
          threads={data.threads}
          currentUserId={data.currentUserId}
          isManager={data.isManager}
        />
      )}
    </div>
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
    <div className="flex flex-col gap-4 max-w-3xl">
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
    <div className="flex flex-col gap-3 max-w-3xl">
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
              <CollaborativeEditor
                key={selected.id}
                editorId={`doc:${selected.id}:body`}
                documentName={`doc:${selected.id}:body`}
                token={collabToken}
                userName={userName}
                enableImages
                enableRichBlocks
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
