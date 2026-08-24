import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { INTERNAL_CYCLES } from "~/hiring/lib/internal-cycles.server";
import { INTERNAL_CYCLE_TYPES, type InternalCycleType } from "~/hiring/lib/internal-cycles";
import { ONBOARDING_EVENT_TYPE } from "~/members/lib/welcome.server";
import { fullName } from "~/lib/display";

// A "task" (todo) is any unread notification — every NotificationKind counts.
// The Tasks sidebar, Home attention banner, and sidebar count all read this
// single predicate so they never disagree. Reading a notification (opening its
// link, submitting the attached form, or hitting "mark all read") clears it
// from tasks. Meeting invites are the exception: they only clear once the
// recipient RSVPs (Accept/Maybe/Decline), and they drop off automatically once
// the meeting is Cancelled or — for a one-off — once it has already happened;
// see TASK_WHERE. Meeting reminders ("Starting soon") are dismissible like any
// other ping, and also drop off once their occurrence time (dueAt) has passed.
//
//   MeetingInvite + scheduledMeetingId → "meeting"  (carries RSVP target)
//   kind === MeetingReminder           → "reminder" (calendar fan-out)
//   kind === SystemAnnouncement        → "announcement" (admin-sent; may have form)
//   everything else                    → "general"
//
// `dueAt` is the deadline chip on the Home banner. Sources, in order:
//   - MeetingInvite / MeetingReminder: the meeting's selectedAt
//   - SystemAnnouncement: Notification.dueAt (admin-set)
//   - General: Notification.dueAt if present, else null
//
// `link` is where acting on the task takes you, preferring an attached form's
// fill page (announcement-todos) over the notification's own link.
//
// Interview-assignment notifications carry an `interviewAssignmentId`. They
// drop out of tasks the moment the assignment is no longer Active (decline /
// replace) or the interview is no longer Scheduled (cancel / complete) — see
// TASK_WHERE below. Notifications NOT linked to an assignment are unaffected.

export type Task = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  source: "meeting" | "reminder" | "announcement" | "general";
  dueAt: string | null;
  // True when the task clears by completing its own action: RSVPing a meeting
  // invite or submitting an attached form. Those carry their own
  // mark-as-read, so they get no Confirm button. Everything else — including
  // tasks that merely link somewhere (interview assignments, a General
  // notification with a link) — is false: opening the link doesn't mean the
  // user is done, so the UI offers a "Confirm" button that marks it read.
  hasAction: boolean;
  // True for a self-clearing form todo (isSelfClearingFormTodo): it clears on
  // submit and so carries no plain "Mark as read", but a recipient who won't
  // (or can't) fill it shouldn't be stuck with it forever. The UI offers a
  // "Dismiss" button that POSTs `intent=dismiss` after a confirm — the one
  // escape hatch the read endpoint honors for these rows.
  formTodo: boolean;
};

// Server-derived display state for a single notification row. Mirrors the
// liveness rules that gate Tasks (see resolveNotificationState).
export type NotificationState =
  | "Open" // unread, still actionable
  | "Submitted" // self-clearing form task that was completed (readAt set via submit)
  | "Cleared" // read normally (mark-read / mark-all / RSVP)
  | "Cancelled" // linked meeting Cancelled or interview assignment no longer Active
  | "Expired"; // had a dueAt that has passed while still unread

// The liveness facts resolveNotificationState needs from one fetched row.
// Mirror this `select` in every caller so the resolver has what it needs.
export type NotifLiveness = {
  readAt: Date | null;
  dueAt: Date | null;
  formId: string | null;
  scheduledMeetingId: string | null;
  scheduledMeeting: { status: string } | null;
  interviewAssignment: { status: string; interview: { status: string } } | null;
};

// Single source of truth for "what state is this notification in", shared by
// the tasks loader and the history view. Mirrors the liveness rules that were
// inline in TASK_WHERE (the Cancelled-meeting and inactive interview-assignment
// branches) so the two surfaces never disagree.
//
// TASK_WHERE *hides* the Cancelled/inactive rows from live surfaces; History
// keeps them and renders this state as an annotation instead.
export function resolveNotificationState(
  n: NotifLiveness,
  now = new Date(),
): NotificationState {
  const meetingDead =
    !!n.scheduledMeetingId && n.scheduledMeeting?.status === "Cancelled";
  const assignmentDead =
    n.interviewAssignment != null &&
    (n.interviewAssignment.status !== "Active" ||
      n.interviewAssignment.interview.status !== "Scheduled");
  if (meetingDead || assignmentDead) return "Cancelled";

  if (n.readAt) {
    // A completed self-clearing form task reads as "Submitted", not "Cleared",
    // and links to its submission rather than re-opening the form.
    if (n.formId) return "Submitted";
    return "Cleared";
  }

  if (n.dueAt && n.dueAt.getTime() < now.getTime()) return "Expired";
  return "Open";
}

// A form-backed todo is self-clearing: submitting the form marks it read
// (closeFormTodos / closeEducationFormTodos), exactly like a meeting invite
// clears only on RSVP. Opening its link — from the sidebar tile, a desktop
// banner, or "mark all read" — must NOT clear it, or an unfilled form silently
// leaves Tasks and shows up in History as "Submitted".
//
// The shape mirrors the `formLink` rule in listOpenTasks: only a published form
// with a public token has a fill page, so a notification whose form can't be
// filled stays plainly dismissible rather than stranded. `SystemAnnouncement`
// matches what the closers actually reopen — anything else would never clear.
export const SELF_CLEARING_FORM_TODO = {
  kind: "SystemAnnouncement",
  isTodo: true,
  form: { is: { published: true, publicToken: { not: null } } },
} satisfies Prisma.NotificationWhereInput;

/** Row-level twin of SELF_CLEARING_FORM_TODO, for single-notification checks. */
export function isSelfClearingFormTodo(n: {
  kind: string;
  isTodo: boolean;
  form: { published: boolean; publicToken: string | null } | null;
}): boolean {
  return (
    n.kind === "SystemAnnouncement" &&
    n.isTodo &&
    !!n.form?.published &&
    !!n.form.publicToken
  );
}

const TASK_WHERE = (
  userId: string,
  now = new Date(),
): Prisma.NotificationWhereInput => ({
  recipientUserId: userId,
  readAt: null,
  // A meeting-invite notification drops off Tasks the moment its meeting is
  // Cancelled — no fan-out delete needed. Notifications not tied to a meeting
  // (the common case) pass via the `null` branch.
  AND: [
    {
      OR: [
        { scheduledMeetingId: null },
        { scheduledMeeting: { status: { not: "Cancelled" } } },
      ],
    },
    // "Starting soon" reminders stamp dueAt to the occurrence start. Once that
    // time has passed the ping is stale — drop it from live Tasks. Pre-fix
    // reminders with null dueAt fall back to the meeting's selectedAt so
    // already-started one-offs clear without a manual dismiss.
    {
      OR: [
        { kind: { not: "MeetingReminder" } },
        { dueAt: { gt: now } },
        {
          AND: [
            { dueAt: null },
            {
              OR: [
                { scheduledMeeting: { selectedAt: { gt: now } } },
                { scheduledMeeting: { selectedAt: null } },
              ],
            },
          ],
        },
      ],
    },
    // An un-RSVP'd invite to a meeting that has already happened is no longer
    // something anyone can act on, so it dismisses itself rather than sitting
    // in Tasks forever waiting for an answer the meeting no longer needs. Only
    // one-offs: a recurring series' selectedAt is its *first* occurrence, and
    // future ones are still worth answering. A meeting still in Searching has
    // no time yet (selectedAt null) and stays open.
    {
      OR: [
        { kind: { not: "MeetingInvite" } },
        { scheduledMeetingId: null },
        { scheduledMeeting: { recurrenceRule: { not: null } } },
        { scheduledMeeting: { selectedAt: null } },
        { scheduledMeeting: { selectedAt: { gt: now } } },
      ],
    },
  ],
  // A notification linked to an InterviewAssignment is only a task while
  // that assignment is still Active on a still-Scheduled interview. As
  // soon as the assignment moves to Declined/Replaced or the interview
  // is Cancelled/Completed, the row drops off both Tasks views without
  // needing any extra fan-out writes. Unlinked notifications (the common
  // case) pass via the `null` branch.
  OR: [
    { interviewAssignmentId: null },
    {
      interviewAssignment: {
        status: "Active",
        interview: { status: "Scheduled" },
      },
    },
  ],
});

/** Count of open tasks for a user. Cheap — used by the sidebar poller. */
export async function countOpenTasks(userId: string, request?: Request): Promise<number> {
  const [notifs, applyTasks] = await Promise.all([
    prisma.notification.count({ where: TASK_WHERE(userId) }),
    getInternalCycleApplyTasks(userId, request),
  ]);
  return notifs + applyTasks.length;
}

const APPLY_TASK_COPY: Record<InternalCycleType, { draft: string; apply: string }> = {
  Fellowship: {
    draft: "Continue your fellowship application",
    apply: "Apply to the fellowship",
  },
  Core: {
    draft: "Continue your Core application",
    apply: "Apply to Core",
  },
};

/**
 * Synthetic "apply to <internal cycle>" tasks: for each internal cycle type
 * (Fellowship, Core) that's Open and the user is eligible for + hasn't finished.
 * These are not Notification rows — they're derived state, so they persist in
 * the attention banner across reloads until the user submits or withdraws.
 */
export async function getInternalCycleApplyTasks(userId: string, request?: Request): Promise<Task[]> {
  const results = await Promise.all(
    INTERNAL_CYCLE_TYPES.map((t) => getInternalCycleApplyTask(userId, t, request)),
  );
  return results.filter((t): t is Task => t != null);
}

async function getInternalCycleApplyTask(
  userId: string,
  cycleType: InternalCycleType,
  request?: Request,
): Promise<Task | null> {
  const config = INTERNAL_CYCLES[cycleType];
  // Eligible check and active-cycle fetch are independent — run them together.
  const [eligible, cycle] = await Promise.all([
    config.eligible(userId),
    getActiveCycle(cycleType),
  ]);
  if (!eligible) return null;
  if (!cycle || cycle.currentStatus !== "Open") return null;

  const app = await prisma.application.findFirst({
    where: { userId, applicationCycleId: cycle.id },
    select: {
      id: true,
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { newStatus: true, createdAt: true } },
    },
  });
  const status = app?.statusUpdates[0]?.newStatus ?? null;
  if (status === "Submitted" || status === "Withdrawn") return null;

  const isDraft = status === "Draft";
  const copy = APPLY_TASK_COPY[cycleType];
  return {
    id: `${cycleType.toLowerCase()}-apply-${cycle.id}`,
    title: isDraft ? copy.draft : copy.apply,
    body: cycle.name,
    link: config.portalPath,
    createdAt: (app?.statusUpdates[0]?.createdAt ?? new Date()).toISOString(),
    source: "general",
    dueAt: cycle.closeDate ? cycle.closeDate.toISOString() : null,
    // Clears by self-action (submit / withdraw in the portal) — no Confirm button.
    hasAction: true,
    formTodo: false,
  };
}

/** Open tasks for a user, newest first, with deadlines resolved. */
export async function listOpenTasks(userId: string, request?: Request): Promise<Task[]> {
  const [rows, applyTasks] = await Promise.all([
    prisma.notification.findMany({
      where: TASK_WHERE(userId),
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        kind: true,
        eventType: true,
        isTodo: true,
        title: true,
        body: true,
        link: true,
        dueAt: true,
        createdAt: true,
        readAt: true,
        formId: true,
        scheduledMeetingId: true,
        scheduledMeeting: { select: { selectedAt: true, status: true } },
        interviewAssignment: {
          select: { status: true, interview: { select: { status: true } } },
        },
        // Attached published form, if any — link the recipient straight to it.
        form: { select: { published: true, publicToken: true } },
      },
    }),
    getInternalCycleApplyTasks(userId, request),
  ]);

  const notifTasks = rows
    // TASK_WHERE already excludes Cancelled-meeting / inactive-assignment rows
    // at the DB level; running them back through the shared resolver keeps the
    // "is this still a live task" definition in one place (no behavior change —
    // Expired/Open both remain tasks; only Cancelled is dropped, which the
    // WHERE already prevents).
    .filter(
      (n) =>
        resolveNotificationState({
          readAt: n.readAt,
          dueAt: n.dueAt,
          formId: n.formId,
          scheduledMeetingId: n.scheduledMeetingId,
          scheduledMeeting: n.scheduledMeeting,
          interviewAssignment: n.interviewAssignment,
        }) !== "Cancelled",
    )
    .map((n) => {
    // Only invites backed by a ScheduledMeeting get RSVP UI. A MeetingInvite
    // without scheduledMeetingId (e.g. a mis-tagged admin blast) is general.
    const source: Task["source"] =
      n.kind === "MeetingInvite" && n.scheduledMeetingId
        ? "meeting"
        : n.kind === "MeetingReminder"
          ? "reminder"
          : n.kind === "SystemAnnouncement"
            ? "announcement"
            : "general";

    const meetingDue = n.scheduledMeeting?.selectedAt?.toISOString() ?? null;
    const notifDue = n.dueAt ? n.dueAt.toISOString() : null;
    // Reminders stamp dueAt to the specific occurrence; prefer that over the
    // series selectedAt so recurring meetings show the right chip.
    const dueAt =
      n.kind === "MeetingReminder"
        ? notifDue ?? meetingDue
        : meetingDue ?? notifDue;

    // Authenticated fill route (not the public /f/ one): the recipient is a
    // logged-in user, and the authed submit is what marks this todo read so
    // the task clears + the count drops once they submit.
    const formLink =
      n.form?.published && n.form.publicToken
        ? `/forms/fill/${n.form.publicToken}`
        : null;

    // A self-clearing action — RSVP (meeting invite), an attached form, or the
    // onboarding task — marks the task read on its own, so no Confirm button. A
    // bare link doesn't count: opening it isn't the same as being done. The
    // onboarding task clears only when the member completes the profile form
    // (see submitMemberForm), so it must NOT offer a manual Confirm.
    // Meeting reminders carry scheduledMeetingId but clear by Confirm / mark-
    // read, not RSVP — only invites are self-clearing via the meeting link.
    const isOnboarding = n.eventType === ONBOARDING_EVENT_TYPE;
    const isMeetingInvite =
      n.kind === "MeetingInvite" && !!n.scheduledMeetingId;
    const hasAction = isMeetingInvite || !!formLink || isOnboarding;
    // A self-clearing form todo has no plain mark-read but is dismissible via
    // the confirm-gated `intent=dismiss` path — mirror the server predicate
    // exactly so the button only shows when the endpoint will honor it.
    const formTodo = isSelfClearingFormTodo({
      kind: n.kind,
      isTodo: n.isTodo,
      form: n.form,
    });

    return {
      id: n.id,
      title: n.title,
      body: n.body,
      link: formLink ?? n.link,
      createdAt: n.createdAt.toISOString(),
      source,
      dueAt,
      hasAction,
      formTodo,
    };
  });

  return [...applyTasks, ...notifTasks];
}

export interface NotificationHistoryOptions {
  status?: "open" | "cleared" | "all"; // default "all"
  kind?: string; // NotificationKind filter
  q?: string; // title/body contains (case-insensitive)
  cursor?: { createdAt: string; id: string } | null; // keyset on (createdAt,id)
  limit?: number; // default 30, max 50
}

export type NotificationHistoryItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  sender: string | null;
  state: NotificationState;
  sentAt: string;
  clearedAt: string | null;
  link: string | null;
  // Present when this row is a MeetingInvite that still needs Accept/Decline.
  // History Open filter surfaces these with the same RSVP UI as Home / My Tasks.
  canRsvp: boolean;
};

export interface NotificationHistoryResult {
  items: NotificationHistoryItem[];
  nextCursor: { createdAt: string; id: string } | null;
  counts: { open: number; cleared: number };
}

const HISTORY_SELECT = {
  id: true,
  kind: true,
  title: true,
  body: true,
  link: true,
  dueAt: true,
  readAt: true,
  createdAt: true,
  formId: true,
  scheduledMeetingId: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  form: { select: { published: true, publicToken: true } },
  scheduledMeeting: { select: { status: true } },
  interviewAssignment: {
    select: { status: true, interview: { select: { status: true } } },
  },
} satisfies Prisma.NotificationSelect;

/**
 * Browsable notification/task history for a user. Unlike listOpenTasks /
 * listMyNotifications this applies NONE of the live-surface hides — stale
 * Cancelled-meeting and inactive interview-assignment rows are returned and
 * annotated via resolveNotificationState so the user can see they existed.
 *
 * Keyset pagination on (createdAt desc, id desc) rides the existing
 * [recipientUserId, createdAt] index. `counts` are the open/cleared totals for
 * the (kind/q-filtered) result set, independent of the status bucket shown.
 */
export async function listNotificationHistory(
  userId: string,
  opts: NotificationHistoryOptions = {},
): Promise<NotificationHistoryResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 30, 50));
  const status = opts.status ?? "all";

  const base: Prisma.NotificationWhereInput = { recipientUserId: userId };
  if (opts.kind) base.kind = opts.kind as Prisma.NotificationWhereInput["kind"];
  if (opts.q) {
    base.OR = [
      { title: { contains: opts.q, mode: "insensitive" } },
      { body: { contains: opts.q, mode: "insensitive" } },
    ];
  }

  // status maps onto readAt only; Cancelled/Expired are derived for display,
  // not stored, so they fall under whichever readAt bucket they live in.
  const statusWhere: Prisma.NotificationWhereInput =
    status === "open"
      ? { readAt: null }
      : status === "cleared"
        ? { NOT: { readAt: null } }
        : {};

  // Keyset pagination on (createdAt, id).
  const cursorWhere: Prisma.NotificationWhereInput = opts.cursor
    ? {
        OR: [
          { createdAt: { lt: new Date(opts.cursor.createdAt) } },
          {
            createdAt: new Date(opts.cursor.createdAt),
            id: { lt: opts.cursor.id },
          },
        ],
      }
    : {};

  const where: Prisma.NotificationWhereInput = {
    AND: [base, statusWhere, cursorWhere],
  };

  const [rows, open, cleared] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1, // overfetch one to detect nextCursor
      select: HISTORY_SELECT,
    }),
    prisma.notification.count({ where: { AND: [base, { readAt: null }] } }),
    prisma.notification.count({
      where: { AND: [base, { NOT: { readAt: null } }] },
    }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items: NotificationHistoryItem[] = page.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    sender: n.createdBy ? fullName(n.createdBy) || null : null,
    state: resolveNotificationState(n),
    sentAt: n.createdAt.toISOString(),
    clearedAt: n.readAt ? n.readAt.toISOString() : null,
    // Submitted form tasks link to the submission; everything else re-opens its
    // own link. Mirrors how listOpenTasks resolves the authed fill route.
    link:
      n.formId && n.form?.published && n.form.publicToken
        ? `/forms/fill/${n.form.publicToken}`
        : n.link,
    canRsvp:
      n.kind === "MeetingInvite" &&
      !!n.scheduledMeetingId &&
      !n.readAt &&
      n.scheduledMeeting?.status !== "Cancelled",
  }));

  const last = page.at(-1);
  const nextCursor =
    hasMore && last
      ? { createdAt: last.createdAt.toISOString(), id: last.id }
      : null;

  return { items, nextCursor, counts: { open, cleared } };
}
