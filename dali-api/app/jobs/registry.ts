// Registry of background jobs. The runner (app/jobs/runner.server.ts) ticks
// every minute, claims due jobs via a DB lease, and calls the handler. Code
// is the source of truth for description/interval; the ScheduledJob row holds
// runtime state (enabled toggle, nextRunAt, lastRun bookkeeping) and self-heals
// from this list, so a wiped dev DB or a staging restore just re-seeds rows.

export type JobResult = { items?: number; note?: string };

export type JobContext = {
  now: Date;
  // The job's last successful run, from its ScheduledJob row. Null on first
  // run or after a DB rebuild. Handlers that batch work over time (digests)
  // gate on this.
  lastSuccessAt: Date | null;
};

export type JobDefinition = {
  name: string; // stable DB key
  description: string; // shown in the admin Jobs panel
  intervalMinutes: number;
  handler: (ctx: JobContext) => Promise<JobResult>;
};

import { runTaskDueReminders } from "~/jobs/task-due-reminders.server";
import { runMeetingReminders } from "~/jobs/meeting-reminders.server";
import { runScheduledAnnouncements } from "~/jobs/scheduled-announcements.server";

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
      "Reminds organizer and participants 15 minutes before a meeting occurrence starts.",
    intervalMinutes: 5,
    handler: runMeetingReminders,
  },
  {
    name: "scheduled-announcements",
    description: "Sends announcements composed with a future send time.",
    intervalMinutes: 1,
    handler: runScheduledAnnouncements,
  },
];

export function jobByName(name: string): JobDefinition | undefined {
  return JOBS.find((j) => j.name === name);
}
