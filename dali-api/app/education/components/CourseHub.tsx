import { Link, Form, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { Button, buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { formatDateTime, formatSessionWhen } from "~/lib/display";
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
import { Check, ChevronRight, FileText, Paperclip, Users } from "lucide-react";

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
    endsAt: string | Date | null;
    location: string | null;
    notes: string | null;
    recordingUrl: string | null;
    checkInOpen: boolean;
    myAttendance: "Present" | "Absent" | "Excused" | null;
  }[];
  materials: {
    id: string;
    title: string;
    isFolder: boolean;
    sessionId: string | null;
    children: { id: string; title: string; sessionId: string | null }[];
  }[];
  workspaceDocs: { id: string; title: string; sessionId: string | null }[];
  files: { id: string; title: string; href: string; sessionId: string | null }[];
  assignments: {
    id: string;
    title: string;
    dueAt: string | Date | null;
    points: number | null;
    sessionSequence: number | null;
    mySubmittedAt: string | Date | null;
    myGrade: string | null;
    myScore: number | null;
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

// The student course view is a session timeline (each session shows its
// materials, attendance, and assignment inline), with Grades / Discussion /
// Overview as secondary destinations. Sequenced-content home beats a tab-per-
// concept split — see specs/education-student-ui.md.
// Overview leads: it's the course at a glance (where it meets, how you're
// doing, your certificate), which is what a student opens the hub for. The
// session list is named for what it holds — "Timeline" described the shape of
// the page rather than the sessions, materials and work on it.
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "sessions", label: "Sessions" },
  { key: "discussions", label: "Discussions" },
  { key: "people", label: "People" },
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
  // `timeline` was this tab's key before it was renamed; a bookmark or an old
  // link still lands on the sessions it always did rather than on nothing.
  const rawTab = searchParams.get("tab") ?? "overview";
  const tab = rawTab === "timeline" ? "sessions" : rawTab;

  // Assignments awaiting this student's submission (past-due ones can't be
  // submitted anymore, so they don't count) — surfaced as a tab badge on
  // Sessions (where the work lives) so new work is visible from anywhere.
  const openAssignments = data.isManager
    ? 0
    : data.assignments.filter(
        (a) => !a.mySubmittedAt && (!a.dueAt || new Date(a.dueAt) > new Date()),
      ).length;

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSearchParams({ tab: t.key }, { preventScrollReset: true })}
            style={
              tab === t.key ? { borderBottomColor: "var(--color-os-accent)" } : undefined
            }
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition",
              tab === t.key ? "text-os-accent" : "text-os-grey hover:text-foreground",
            )}
          >
            {t.label}
            {t.key === "sessions" && openAssignments > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-os-accent px-1.5 text-[11px] font-bold text-os-card">
                {openAssignments}
              </span>
            )}
          </button>
        ))}
        <span aria-hidden className="flex-1 border-b-2" />
      </nav>

      {tab === "sessions" && (
        <SessionTimeline
          sessions={data.sessions}
          materials={data.materials}
          assignments={data.assignments}
          sharedDocs={data.workspaceDocs}
          files={data.files}
          basePath={basePath}
          tz={tz}
          isManager={data.isManager}
        />
      )}

      {tab === "people" && (
        <PeopleTab instructors={data.instructors} classmates={data.classmates} />
      )}

      {tab === "overview" && (
        <div className="flex flex-col gap-5">
          {data.myCertificateId && (
            <section className="flex items-center justify-between gap-4 rounded-os-card bg-os-accent/10 px-5 py-4">
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
            <section className="rounded-os-card bg-os-accent/10 p-5">
              <p className="text-xs font-semibold text-os-accent">
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
          <section className="rounded-os-card bg-os-card p-6">
            <h2 className="font-heading text-[19px] font-semibold text-foreground">
              About this course
            </h2>
            {data.offering.descriptionHtml ? (
              <div
                className="prose prose-sm dark:prose-invert mt-2 max-w-none"
                dangerouslySetInnerHTML={{ __html: data.offering.descriptionHtml }}
              />
            ) : (
              <p className="mt-2 text-sm text-os-grey italic">
                No description yet.
              </p>
            )}
          </section>

        </div>
      )}

      {tab === "discussions" && (
        <div className="flex flex-col gap-5">
          {data.announcements.length > 0 && (
            <section>
              <h2 className="mb-3 font-heading text-[19px] font-semibold text-foreground">
                Announcements
              </h2>
              {/* Read-only here: announcements are a broadcast from the
                  instructors. Replies and questions go in the board below. */}
              <ul className="flex flex-col gap-2">
                {data.announcements.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-os-card bg-os-accent/10 p-5"
                  >
                    <p className="text-xs text-os-grey">
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

// A single thing attached to a session or the whole course on the student
// timeline: a read-only material page, a co-edited shared doc, or an uploaded
// file. These three live together instead of in separate Materials /
// shared-doc / Files buckets.
type TimelineResource =
  | { kind: "material"; id: string; title: string }
  | { kind: "shared"; id: string; title: string }
  | { kind: "file"; id: string; title: string; href: string };

const RESOURCE_ICON = { material: FileText, shared: Users, file: Paperclip } as const;

/** Inline resource link, used under a session row. Files open the Drive viewer
 *  in a new tab; materials + shared docs open their in-app page. */
function ResourceChip({ r, basePath }: { r: TimelineResource; basePath: string }) {
  const Icon = RESOURCE_ICON[r.kind];
  const className = "inline-flex items-center gap-1 text-os-accent hover:underline";
  const inner = (
    <>
      <Icon className="h-3 w-3" aria-hidden />
      {r.title}
      {r.kind === "shared" && (
        <span className="rounded-full bg-os-accent/15 px-1.5 text-[9px] font-semibold uppercase tracking-wide text-os-accent">
          Shared
        </span>
      )}
    </>
  );
  if (r.kind === "file") {
    return (
      <a href={r.href} target="_blank" rel="noreferrer" className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={`${basePath}/page/${r.id}`} className={className}>
      {inner}
    </Link>
  );
}

/** Full-width resource card, used in the "Whole course" group. */
function ResourceCard({ r, basePath }: { r: TimelineResource; basePath: string }) {
  const Icon = RESOURCE_ICON[r.kind];
  const className =
    "group flex items-center gap-3 rounded-os-card bg-os-card px-5 py-3.5 transition-colors hover:bg-os-card-hover";
  const inner = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-os-item bg-os-accent/10 text-os-accent">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-os-accent">
        {r.title}
      </span>
      {r.kind === "shared" && (
        <span className="shrink-0 rounded-full bg-os-accent/15 px-2 py-0.5 text-[10px] font-semibold text-os-accent">
          Shared
        </span>
      )}
      <ChevronRight
        className="h-4 w-4 shrink-0 text-os-grey/60 group-hover:text-os-accent"
        aria-hidden
      />
    </>
  );
  if (r.kind === "file") {
    return (
      <a href={r.href} target="_blank" rel="noreferrer" className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={`${basePath}/page/${r.id}`} className={className}>
      {inner}
    </Link>
  );
}

/** Canvas-style roster: instructors and students, each as an avatar row. */
function PeopleTab({
  instructors,
  classmates,
}: {
  instructors: HubData["instructors"];
  classmates: HubData["classmates"];
}) {
  const Group = ({
    label,
    people,
  }: {
    label: string;
    people: { id: string; name: string; photoUrl: string | null; isMe?: boolean; role?: string }[];
  }) => (
    <section>
      <h2 className="mb-3 font-heading text-[19px] font-semibold text-foreground">
        {label} · {people.length}
      </h2>
      <ul className="divide-y divide-os-container rounded-os-card bg-os-card">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            <Avatar photoUrl={p.photoUrl} name={p.name} size="sm" />
            <span className="text-sm font-medium text-foreground">{p.name}</span>
            {p.isMe && (
              <span className="rounded-full bg-os-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-os-accent">
                You
              </span>
            )}
            {p.role && <span className="ml-auto text-xs text-os-grey">{p.role}</span>}
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="flex flex-col gap-5">
      {instructors.length > 0 && (
        <Group
          label={instructors.length === 1 ? "Instructor" : "Instructors"}
          people={instructors.map((i) => ({ ...i, role: "Instructor" }))}
        />
      )}
      <Group label="Students" people={classmates} />
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
    <div className="flex flex-col gap-4">
      <Form method="post" className="os-form rounded-os-card bg-os-card p-5">
        <input type="hidden" name="intent" value="post-discussion" />
        <textarea
          name="body"
          required
          rows={3}
          placeholder="Ask a question or share something with the class…"
          className="w-full"
        />
        <div className="mt-2">
          <Button type="submit" size="sm">
            Post
          </Button>
        </div>
      </Form>

      {threads.map((t) => (
        <div key={t.id} className="rounded-os-card bg-os-card p-5">
          <PostBody
            post={t}
            currentUserId={currentUserId}
            isManager={isManager}
          />
          <div className="mt-3 ml-5 flex flex-col gap-3 border-l-2 border-os-container pl-4">
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
        <p className="text-sm text-os-grey italic">
          No posts yet — start the discussion above.
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
      <p className="text-xs text-os-grey flex items-center gap-2">
        <span className="font-semibold text-foreground">{post.authorName}</span>
        {post.isInstructor && (
          <span className="inline-flex items-center rounded-full bg-os-accent/15 text-os-accent px-2 py-0.5 text-[10px] font-semibold">
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
              className="text-[11px] text-os-grey hover:text-destructive underline"
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
        className="self-start text-xs text-os-grey hover:text-foreground underline"
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
        className="w-full"
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

/** One-tap self-check-in for the student, used on the Overview "up next" card and
 *  each open session row. Posts to the same endpoint the projected QR opens. */
function SessionCheckInButton({
  sessionId,
  initialPresent,
}: {
  sessionId: string;
  initialPresent: boolean;
}) {
  const [present, setPresent] = useState(initialPresent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/education/sessions/${sessionId}/check-in`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Check-in failed");
        return;
      }
      setPresent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (present) {
    return <span className="text-xs font-semibold text-os-accent">✓ Checked in</span>;
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" onClick={checkIn} disabled={submitting}>
        {submitting ? "Checking in…" : "Check in"}
      </Button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}

/**
 * The student course home: sessions in chronological order, each showing its
 * attendance (or a check-in button when open), materials, recording, and
 * assignment inline — plus a "Whole course" group for anything not tied to a
 * session. Sequenced-content home over a tab-per-concept split; see
 * specs/education-student-ui.md.
 */
function SessionTimeline({
  sessions,
  materials,
  assignments,
  sharedDocs,
  files,
  basePath,
  tz,
  isManager,
}: {
  sessions: HubData["sessions"];
  materials: HubData["materials"];
  assignments: HubData["assignments"];
  /** Co-edited docs + uploaded files placed on the timeline. */
  sharedDocs: HubData["workspaceDocs"];
  files: HubData["files"];
  basePath: string;
  tz: string;
  isManager: boolean;
}) {
  const now = new Date();
  // Flatten the 2-level materials tree; folders themselves aren't openable.
  const flatMaterials = materials.flatMap((m) => [
    { id: m.id, title: m.title, sessionId: m.sessionId, isFolder: m.isFolder },
    ...m.children.map((c) => ({ id: c.id, title: c.title, sessionId: c.sessionId, isFolder: false })),
  ]);
  // Files open in the member file viewer (/documents/file/:id); the portal shell
  // bounces Dartmouth students there, so on the portal surface they go through
  // the enrollment-gated portal file route instead.
  const fileHref = (id: string) =>
    basePath.startsWith("/portal") ? `${basePath}/file/${id}` : `/documents/file/${id}`;
  // Every timeline resource (material / shared doc / file) reduced to one shape,
  // tagged with the session it belongs to (null = whole course).
  const allResources: (TimelineResource & { sessionId: string | null })[] = [
    ...flatMaterials
      .filter((f) => !f.isFolder)
      .map((m) => ({ kind: "material" as const, id: m.id, title: m.title, sessionId: m.sessionId })),
    ...sharedDocs.map((d) => ({ kind: "shared" as const, id: d.id, title: d.title, sessionId: d.sessionId })),
    ...files.map((f) => ({ kind: "file" as const, id: f.id, title: f.title, href: fileHref(f.id), sessionId: f.sessionId })),
  ];
  const resourcesForSession = (sid: string) => allResources.filter((r) => r.sessionId === sid);
  const generalResources = allResources.filter((r) => r.sessionId == null);
  const assignmentsForSession = (seq: number) =>
    assignments.filter((a) => a.sessionSequence === seq);
  const generalAssignments = assignments.filter((a) => a.sessionSequence == null);

  const present = sessions.filter((s) => s.myAttendance === "Present").length;
  const submitted = assignments.filter((a) => a.mySubmittedAt).length;
  const nextId =
    sessions
      .filter((s) => new Date(s.endsAt ?? s.datetime) >= now)
      .sort((a, b) => +new Date(a.datetime) - +new Date(b.datetime))[0]?.id ?? null;
  const nextSession = sessions.find((s) => s.id === nextId) ?? null;

  if (sessions.length === 0 && allResources.length === 0 && assignments.length === 0) {
    return <p className="text-sm text-os-grey italic">Nothing scheduled yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header strip: where the student stands + what's next. */}
      {sessions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-os-card bg-os-card px-5 py-3.5 text-sm">
          <span className="text-foreground">
            <strong className="font-semibold">
              {present}/{sessions.length}
            </strong>{" "}
            <span className="text-os-grey">attended</span>
          </span>
          {assignments.length > 0 && (
            <span className="text-foreground">
              <strong className="font-semibold">
                {submitted}/{assignments.length}
              </strong>{" "}
              <span className="text-os-grey">submitted</span>
            </span>
          )}
          {nextSession && (
            <span className="text-os-grey">
              next: {nextSession.title ? nextSession.title : `Session ${nextSession.sequence}`} ·{" "}
              {formatSessionWhen(nextSession.datetime, nextSession.endsAt, tz)}
            </span>
          )}
        </div>
      )}

      <ol className="flex flex-col gap-2">
        {sessions.map((s) => {
          const past = new Date(s.endsAt ?? s.datetime) < now;
          const isNext = s.id === nextId;
          const res = resourcesForSession(s.id);
          const asgs = assignmentsForSession(s.sequence);
          return (
            <li
              key={s.id}
              className={cn(
                "rounded-os-card bg-os-card p-5",
                isNext ? "ring-2 ring-os-accent/40" : "",
              )}
            >
              <div className="flex items-start gap-3">
                <SessionDot present={s.myAttendance === "Present"} past={past} isNext={isNext} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {s.title ? `${s.sequence}. ${s.title}` : `Session ${s.sequence}`}
                    </p>
                    {s.myAttendance ? (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          ATTENDANCE_STYLE[s.myAttendance],
                        )}
                      >
                        {s.myAttendance}
                      </span>
                    ) : !isManager && s.checkInOpen ? (
                      <SessionCheckInButton sessionId={s.id} initialPresent={false} />
                    ) : null}
                  </div>
                  <p className="text-xs text-os-grey">
                    {formatSessionWhen(s.datetime, s.endsAt, tz)}
                    {s.location ? ` · ${s.location}` : ""}
                  </p>
                  {s.notes && (
                    <p className="mt-1 text-xs text-os-grey/90 whitespace-pre-line">
                      {s.notes}
                    </p>
                  )}
                  {(res.length > 0 || s.recordingUrl) && (
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                      {res.map((r) => (
                        <ResourceChip key={`${r.kind}-${r.id}`} r={r} basePath={basePath} />
                      ))}
                      {s.recordingUrl && (
                        <a
                          href={s.recordingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-os-accent hover:underline"
                        >
                          ▶ Recording
                        </a>
                      )}
                    </div>
                  )}
                  {asgs.map((a) => (
                    <AssignmentRow key={a.id} a={a} basePath={basePath} tz={tz} />
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {(generalResources.length > 0 || generalAssignments.length > 0) && (
        <section className="rounded-os-card bg-os-card p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-os-grey">
            Whole course
          </h3>
          <div className="flex flex-col gap-2">
            {generalResources.map((r) => (
              <ResourceCard key={`${r.kind}-${r.id}`} r={r} basePath={basePath} />
            ))}
            {generalAssignments.map((a) => (
              <AssignmentRow key={a.id} a={a} basePath={basePath} tz={tz} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SessionDot({
  present,
  past,
  isNext,
}: {
  present: boolean;
  past: boolean;
  isNext: boolean;
}) {
  if (present) {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-os-accent text-os-card">
        <Check className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "mt-0.5 h-5 w-5 shrink-0 rounded-full border-2",
        isNext ? "border-os-accent" : past ? "border-os-grey/40" : "border-os-container",
      )}
      aria-hidden
    />
  );
}

/** An assignment inline under its session (or in "Whole course"): title + this
 *  student's status for it — graded score, submitted, or due date + Open. */
function AssignmentRow({
  a,
  basePath,
  tz,
}: {
  a: HubData["assignments"][number];
  basePath: string;
  tz: string;
}) {
  const graded = a.myGrade != null || a.myScore != null;
  const overdue = !a.mySubmittedAt && a.dueAt != null && new Date(a.dueAt) < new Date();
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="text-os-grey">Assignment:</span>
      <Link
        to={`${basePath}/assignments/${a.id}`}
        className="font-medium text-foreground hover:text-os-accent"
      >
        {a.title}
      </Link>
      {graded ? (
        <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">
          {a.myScore != null && a.points != null
            ? `${a.myScore}/${a.points}`
            : (a.myGrade ?? String(a.myScore))}
        </span>
      ) : a.mySubmittedAt ? (
        <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">
          Submitted
        </span>
      ) : (
        <>
          <span className={overdue ? "font-medium text-red-600" : "text-os-grey"}>
            {a.dueAt ? `due ${formatDateTime(a.dueAt, tz)}` : "no due date"}
          </span>
          <Link
            to={`${basePath}/assignments/${a.id}`}
            className="font-semibold text-os-accent hover:underline"
          >
            Open
          </Link>
        </>
      )}
    </div>
  );
}

