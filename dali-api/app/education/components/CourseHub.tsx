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
import { Check, ChevronRight, FileText } from "lucide-react";

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
  workspaceDocs: { id: string; title: string }[];
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
const TABS = [
  { key: "timeline", label: "Timeline" },
  { key: "grades", label: "Grades" },
  { key: "discussions", label: "Discussions" },
  { key: "overview", label: "Overview" },
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
  const tab = searchParams.get("tab") ?? "timeline";

  // Workspace tab only when the offering has shared collaborative docs. Insert
  // it before Overview (after Discussions) so the co-edited docs sit with the
  // other communication surfaces.
  const tabs = data.workspaceDocs.length > 0
    ? [...TABS.slice(0, 3), { key: "workspace", label: "Workspace" } as const, ...TABS.slice(3)]
    : TABS;

  // Assignments awaiting this student's submission (past-due ones can't be
  // submitted anymore, so they don't count) — surfaced as a tab badge on the
  // timeline (where the work lives) so new work is visible from anywhere.
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
            {t.key === "timeline" && openAssignments > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-accent-coral text-white text-[10px] font-bold min-w-4 h-4 px-1">
                {openAssignments}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === "timeline" && (
        <SessionTimeline
          sessions={data.sessions}
          materials={data.materials}
          assignments={data.assignments}
          basePath={basePath}
          tz={tz}
          isManager={data.isManager}
        />
      )}

      {tab === "grades" && (
        <GradesTab
          sessions={data.sessions}
          assignments={data.assignments}
          myCertificateId={data.myCertificateId}
          tz={tz}
        />
      )}

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

      {tab === "workspace" && (
        <WorkspaceTab
          docs={data.workspaceDocs}
          collabToken={collabToken ?? null}
          userName={data.currentUserName}
        />
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

/** One number on the Overview progress row (attendance, assignments, grades). */
function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
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
    return <span className="text-xs font-semibold text-accent-teal">✓ Checked in</span>;
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
  basePath,
  tz,
  isManager,
}: {
  sessions: HubData["sessions"];
  materials: HubData["materials"];
  assignments: HubData["assignments"];
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
  const materialsForSession = (sid: string) =>
    flatMaterials.filter((f) => !f.isFolder && f.sessionId === sid);
  const generalMaterials = flatMaterials.filter((f) => !f.isFolder && !f.sessionId);
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

  if (sessions.length === 0 && generalMaterials.length === 0 && assignments.length === 0) {
    return <p className="text-sm text-muted-foreground italic">Nothing scheduled yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header strip: where the student stands + what's next. */}
      {sessions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <span className="text-foreground">
            <strong className="font-semibold">
              {present}/{sessions.length}
            </strong>{" "}
            <span className="text-muted-foreground">attended</span>
          </span>
          {assignments.length > 0 && (
            <span className="text-foreground">
              <strong className="font-semibold">
                {submitted}/{assignments.length}
              </strong>{" "}
              <span className="text-muted-foreground">submitted</span>
            </span>
          )}
          {nextSession && (
            <span className="text-muted-foreground">
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
          const mats = materialsForSession(s.id);
          const asgs = assignmentsForSession(s.sequence);
          return (
            <li
              key={s.id}
              className={cn(
                "rounded-lg border bg-card p-4",
                isNext ? "border-accent-coral/40 ring-1 ring-accent-coral/20" : "border-border",
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
                  <p className="text-xs text-muted-foreground">
                    {formatSessionWhen(s.datetime, s.endsAt, tz)}
                    {s.location ? ` · ${s.location}` : ""}
                  </p>
                  {s.notes && (
                    <p className="mt-1 text-xs text-muted-foreground/90 whitespace-pre-line">
                      {s.notes}
                    </p>
                  )}
                  {(mats.length > 0 || s.recordingUrl) && (
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                      {mats.map((m) => (
                        <Link
                          key={m.id}
                          to={`${basePath}/page/${m.id}`}
                          className="inline-flex items-center gap-1 text-accent-teal hover:underline"
                        >
                          <FileText className="h-3 w-3" aria-hidden />
                          {m.title}
                        </Link>
                      ))}
                      {s.recordingUrl && (
                        <a
                          href={s.recordingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent-teal hover:underline"
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

      {(generalMaterials.length > 0 || generalAssignments.length > 0) && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Whole course
          </h3>
          <div className="flex flex-col gap-2">
            {generalMaterials.map((m) => (
              <MaterialLink key={m.id} to={`${basePath}/page/${m.id}`} title={m.title} />
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
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-teal text-white">
        <Check className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "mt-0.5 h-5 w-5 shrink-0 rounded-full border-2",
        isNext ? "border-accent-coral" : past ? "border-muted-foreground/40" : "border-border",
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
      <span className="text-muted-foreground">Assignment:</span>
      <Link
        to={`${basePath}/assignments/${a.id}`}
        className="font-medium text-foreground hover:text-accent-coral"
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
          <span className={overdue ? "font-medium text-red-600" : "text-muted-foreground"}>
            {a.dueAt ? `due ${formatDateTime(a.dueAt, tz)}` : "no due date"}
          </span>
          <Link
            to={`${basePath}/assignments/${a.id}`}
            className="font-semibold text-accent-coral hover:underline"
          >
            Open
          </Link>
        </>
      )}
    </div>
  );
}

/** Grades tab: the student's standing (attendance + certificate) and a table of
 *  every assignment with its score and status. */
function GradesTab({
  sessions,
  assignments,
  myCertificateId,
  tz,
}: {
  sessions: HubData["sessions"];
  assignments: HubData["assignments"];
  myCertificateId: string | null;
  tz: string;
}) {
  const present = sessions.filter((s) => s.myAttendance === "Present").length;
  const total = sessions.length;
  const pct = total > 0 ? Math.round((present / total) * 100) : null;
  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Attendance"
          value={total > 0 ? `${present}/${total}` : "—"}
          hint={pct != null ? `${pct}% of sessions` : "No sessions yet"}
        />
        <StatCard
          label="Assignments"
          value={
            assignments.length > 0
              ? `${assignments.filter((a) => a.mySubmittedAt).length}/${assignments.length}`
              : "—"
          }
          hint={assignments.length > 0 ? "submitted" : "None assigned"}
        />
        <StatCard
          label="Certificate"
          value={myCertificateId ? "Earned" : "—"}
          hint={myCertificateId ? "course complete" : "on completion"}
        />
      </section>

      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No graded work yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-semibold">Assignment</th>
                <th className="px-4 py-2 font-semibold">Due</th>
                <th className="px-4 py-2 text-right font-semibold">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {assignments.map((a) => {
                const graded = a.myGrade != null || a.myScore != null;
                return (
                  <tr key={a.id}>
                    <td className="px-4 py-2 text-foreground">{a.title}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {a.dueAt ? formatDateTime(a.dueAt, tz) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-foreground">
                      {graded ? (
                        a.myScore != null && a.points != null ? (
                          `${a.myScore}/${a.points}`
                        ) : (
                          (a.myGrade ?? String(a.myScore))
                        )
                      ) : a.mySubmittedAt ? (
                        <span className="font-normal text-blue-700">Submitted</span>
                      ) : (
                        <span className="font-normal text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
