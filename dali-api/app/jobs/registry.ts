// Registry of background jobs. The runner (app/jobs/runner.server.ts) ticks
// every minute, claims due jobs via a DB lease, and calls the handler.
//
// What lives where:
//   code (this file)  — which jobs exist, descriptions, DEFAULT interval,
//                       declared settings (numeric knobs) with their defaults.
//   ScheduledJob row  — runtime state (enabled, nextRunAt, lastRun*) AND the
//                       operator-editable values: intervalMinutes and settings,
//                       both editable from Admin → Jobs. The registry only
//                       seeds them at row creation; it never overwrites.
// Rows self-heal from this list, so a wiped dev DB or a staging restore just
// re-seeds defaults.

export type JobResult = { items?: number; note?: string };

// A numeric, operator-editable knob. Declaring one here is all it takes for
// the admin panel to render an input and for the handler to receive the
// resolved value in ctx.settings.
export type JobSettingDef = {
  key: string;
  label: string; // shown in the admin panel
  unit: string; // "min", "hours", "days", …
  min: number;
  max: number;
  default: number;
};

export type JobContext = {
  now: Date;
  // The job's last successful run, from its ScheduledJob row. Null on first
  // run or after a DB rebuild. Handlers that batch work over time (digests)
  // gate on this.
  lastSuccessAt: Date | null;
  // Declared settings resolved against the row's stored values — every
  // declared key is present (stored value when valid, else the default).
  settings: Record<string, number>;
};

export type JobDefinition = {
  name: string; // stable DB key
  description: string; // shown in the admin Jobs panel
  intervalMinutes: number; // default cadence; the row's value wins once created
  settings?: JobSettingDef[];
  handler: (ctx: JobContext) => Promise<JobResult>;
};

/**
 * Overlay a row's stored settings JSON onto the declared defaults. Unknown
 * keys are dropped; non-finite or out-of-range values fall back to the
 * default — a hand-edited row can degrade a job to its defaults but never
 * break it.
 */
export function resolveJobSettings(
  def: JobDefinition,
  stored: unknown,
): Record<string, number> {
  const raw = (stored ?? {}) as Record<string, unknown>;
  const resolved: Record<string, number> = {};
  for (const s of def.settings ?? []) {
    const value = raw[s.key];
    resolved[s.key] =
      typeof value === "number" && Number.isFinite(value) && value >= s.min && value <= s.max
        ? value
        : s.default;
  }
  return resolved;
}

import { runTaskDueReminders } from "~/jobs/task-due-reminders.server";
import { runMeetingReminders } from "~/jobs/meeting-reminders.server";
import { runScheduledAnnouncements } from "~/jobs/scheduled-announcements.server";
import { runSessionFeedbackSweep } from "~/jobs/session-feedback-sweep.server";
import { runDailyDigest, runWeeklyDigest } from "~/lib/notification-digest.server";
import { runRetentionJanitor } from "~/jobs/retention-janitor.server";
import { runSprintLifecycle } from "~/jobs/sprint-lifecycle.server";
import { runFormWindows } from "~/jobs/form-windows.server";
import { runInterviewReminders } from "~/jobs/interview-reminders.server";
import { runStandupPrompts } from "~/jobs/standup-prompts.server";
import { runTaskAutoArchive } from "~/jobs/task-auto-archive.server";

export const JOBS: JobDefinition[] = [
  {
    name: "task-due-reminders",
    description:
      "Reminds assignees a day before and at the moment a task's deadline hits.",
    intervalMinutes: 5,
    handler: runTaskDueReminders,
  },
  {
    name: "meeting-reminders",
    description:
      "Reminds organizer and participants before a meeting occurrence starts.",
    intervalMinutes: 5,
    settings: [
      {
        key: "leadMinutes",
        label: "Lead time before start",
        unit: "min",
        min: 1,
        max: 720,
        default: 15,
      },
    ],
    handler: runMeetingReminders,
  },
  {
    name: "scheduled-announcements",
    description: "Sends announcements composed with a future send time.",
    intervalMinutes: 1,
    handler: runScheduledAnnouncements,
  },
  {
    name: "session-feedback-sweep",
    description:
      "Requests session feedback once an education session ends, even when attendance was never marked.",
    intervalMinutes: 60,
    settings: [
      {
        key: "graceHours",
        label: "Grace after session start",
        unit: "hours",
        min: 0,
        max: 48,
        default: 2,
      },
      {
        key: "lookbackDays",
        label: "How far back to sweep",
        unit: "days",
        min: 1,
        max: 60,
        default: 14,
      },
    ],
    handler: runSessionFeedbackSweep,
  },
  // The digest jobs tick often but self-gate on wall clock, using the
  // runner's lastSuccessAt as the sent-today cursor.
  {
    name: "notification-digest-daily",
    description: "Emails each Daily-digest subscriber their unread notifications each morning.",
    intervalMinutes: 15,
    settings: [
      {
        key: "sendHourEt",
        label: "Send hour (ET, 0–23)",
        unit: "h",
        min: 0,
        max: 23,
        default: 9,
      },
    ],
    handler: runDailyDigest,
  },
  {
    name: "notification-digest-weekly",
    description:
      "Emails each Weekly-digest subscriber their unread notifications once a week.",
    intervalMinutes: 15,
    settings: [
      {
        key: "sendHourEt",
        label: "Send hour (ET, 0–23)",
        unit: "h",
        min: 0,
        max: 23,
        default: 9,
      },
      {
        key: "sendWeekday",
        label: "Send day (0=Sun … 6=Sat)",
        unit: "",
        min: 0,
        max: 6,
        default: 1,
      },
    ],
    handler: runWeeklyDigest,
  },
  {
    name: "interview-reminders",
    description:
      "Emails applicant and interviewers 24 hours and 1 hour before a scheduled interview.",
    intervalMinutes: 5,
    handler: runInterviewReminders,
  },
  {
    name: "form-windows",
    description:
      "Publishes and unpublishes forms whose scheduled open/close time has passed.",
    intervalMinutes: 1,
    handler: runFormWindows,
  },
  {
    name: "sprint-lifecycle",
    description:
      "Closes Active sprints past their end date, rolls unfinished tasks to the next Planned sprint (else the backlog), and posts a summary to the project's Slack channel.",
    intervalMinutes: 60,
    handler: runSprintLifecycle,
  },
  {
    name: "standup-prompts",
    description:
      "Posts a weekday standup prompt to each Active project's Slack channel.",
    intervalMinutes: 15,
    settings: [
      {
        key: "sendHourEt",
        label: "Post hour (ET, 0–23)",
        unit: "h",
        min: 0,
        max: 23,
        default: 10,
      },
    ],
    handler: runStandupPrompts,
  },
  {
    name: "retention-janitor",
    description:
      "Deletes read notifications and stale reminder-ledger rows older than the retention window.",
    intervalMinutes: 1440,
    settings: [
      {
        key: "retentionMonths",
        label: "Retention window",
        unit: "months",
        min: 1,
        max: 36,
        default: 6,
      },
    ],
    handler: runRetentionJanitor,
  },
  {
    name: "task-auto-archive",
    description:
      "Archives Done/Cancelled tasks left untouched past the threshold so they drop off the project board.",
    intervalMinutes: 1440,
    settings: [
      {
        key: "archiveAfterDays",
        label: "Archive after (idle)",
        unit: "days",
        min: 1,
        max: 365,
        default: 30,
      },
    ],
    handler: runTaskAutoArchive,
  },
];

export function jobByName(name: string): JobDefinition | undefined {
  return JOBS.find((j) => j.name === name);
}
