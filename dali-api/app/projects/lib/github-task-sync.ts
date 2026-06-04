import { prisma } from "~/lib/db";
import { githubAppClient, parseRepo, isNotFound } from "~/lib/github";
import type { TaskStatus } from "./task-board";

// dalios Task → GitHub issue mirror. Fire-and-forget from route handlers
// (see api.projects.$id.tasks.ts, api.tasks.$id.ts, api.tasks.$id.move.ts).
// Failures are logged and swallowed so a GH outage never blocks user writes.

const STATUS_LABELS: Record<TaskStatus, string | null> = {
  Todo: "status:todo",
  InProgress: "status:in-progress",
  InReview: "status:in-review",
  Done: null,
  Cancelled: null,
};

const ALL_STATUS_LABELS = [
  "status:todo",
  "status:in-progress",
  "status:in-review",
];

function appBaseUrl(): string {
  return process.env.API_BASE_URL ?? "https://os.dali.dartmouth.edu";
}

// Normalize a Project.repoUrls entry into "owner/repo". Strips scheme/host,
// trailing slash, and a `.git` suffix. Returns null if the result isn't a
// clean "owner/repo".
export function normalizeRepo(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^https?:\/\/[^/]+\//, "");
  s = s.replace(/^git@[^:]+:/, "");
  s = s.replace(/\.git$/, "");
  s = s.replace(/\/+$/, "");
  return /^[^/\s]+\/[^/\s]+$/.test(s) ? s : null;
}

// ─── Loop suppression ───────────────────────────────────────────────────────
// Inbound webhook deliveries for events we just caused would echo our own
// writes back into dalios. We mark each outbound write and the webhook handler
// drops events that match a recent marker. In-memory, single-process — Fly
// scales these dynos; cross-process echo would still re-enter, but the inbound
// handler is idempotent (it only writes when the state would change).
const RECENT_TTL_MS = 5_000;
const recentWrites = new Map<string, number>();

function key(repo: string, num: number): string {
  return `${repo}#${num}`;
}

export function markRecentOutbound(repo: string, num: number): void {
  const k = key(repo, num);
  recentWrites.set(k, Date.now() + RECENT_TTL_MS);
}

export function wasRecentOutbound(repo: string, num: number): boolean {
  const k = key(repo, num);
  const exp = recentWrites.get(k);
  if (!exp) return false;
  if (exp < Date.now()) {
    recentWrites.delete(k);
    return false;
  }
  return true;
}

// ─── Public surface ─────────────────────────────────────────────────────────

export async function createIssueForTask(taskId: string, repoInput: string): Promise<void> {
  const repo = normalizeRepo(repoInput);
  if (!repo) {
    console.error(`github-task-sync: bad repo "${repoInput}" for task ${taskId}`);
    return;
  }
  try {
    const task = await loadTask(taskId);
    if (!task) return;
    if (task.githubIssueNumber !== null) return; // already linked

    const { owner, repo: name } = parseRepo(repo, "createIssueForTask");
    const gh = githubAppClient();

    const { assignees, missing } = resolveAssignees(task.assignees);
    const body = `Tracked in dalios: ${appBaseUrl()}/projects/${task.projectId}/tasks/${task.id}`;

    const res = await gh.rest.issues.create({
      owner,
      repo: name,
      title: task.title,
      body,
      assignees,
    });
    markRecentOutbound(repo, res.data.number);

    await prisma.task.update({
      where: { id: task.id },
      data: {
        githubRepo: repo,
        githubIssueNumber: res.data.number,
        githubIssueUrl: res.data.html_url,
      },
    });

    // Apply the initial status label. Don't await — order doesn't matter.
    await applyStatusLabel(owner, name, res.data.number, task.status);

    if (missing.length > 0) {
      await postMissingAssigneesComment(owner, name, res.data.number, missing);
    }
  } catch (err) {
    console.error(`github-task-sync: createIssueForTask(${taskId}) failed`, err);
  }
}

export async function syncIssueForTask(taskId: string): Promise<void> {
  try {
    const task = await loadTask(taskId);
    if (!task || !task.githubRepo || task.githubIssueNumber === null) return;

    const { owner, repo: name } = parseRepo(task.githubRepo, "syncIssueForTask");
    const number = task.githubIssueNumber;
    const gh = githubAppClient();

    const { assignees, missing } = resolveAssignees(task.assignees);

    // Replace assignees with the full set: GitHub doesn't have a "set"
    // primitive, so we remove anything that isn't in the new set, then add.
    const current = await gh.rest.issues.get({ owner, repo: name, issue_number: number });
    const currentAssignees = (current.data.assignees ?? [])
      .map((a) => a?.login)
      .filter((l): l is string => !!l);
    const toRemove = currentAssignees.filter((l) => !assignees.includes(l));

    markRecentOutbound(task.githubRepo, number);
    const closing = task.status === "Done" || task.status === "Cancelled";
    await gh.rest.issues.update({
      owner,
      repo: name,
      issue_number: number,
      title: task.title,
      state: closing ? "closed" : "open",
      // state_reason is only meaningful when closing; omit for reopens.
      ...(closing
        ? { state_reason: task.status === "Cancelled" ? "not_planned" : "completed" }
        : {}),
    });

    if (toRemove.length > 0) {
      markRecentOutbound(task.githubRepo, number);
      await gh.rest.issues.removeAssignees({
        owner,
        repo: name,
        issue_number: number,
        assignees: toRemove,
      });
    }
    if (assignees.length > 0) {
      markRecentOutbound(task.githubRepo, number);
      await gh.rest.issues.addAssignees({
        owner,
        repo: name,
        issue_number: number,
        assignees,
      });
    }

    await applyStatusLabel(owner, name, number, task.status);

    if (missing.length > 0) {
      await postMissingAssigneesComment(owner, name, number, missing);
    }
  } catch (err) {
    if (isNotFound(err)) {
      // Issue was deleted on GH. Clear the link so future edits don't keep
      // failing; user sees the link disappear from the task.
      await prisma.task
        .update({
          where: { id: taskId },
          data: { githubRepo: null, githubIssueNumber: null, githubIssueUrl: null },
        })
        .catch(() => {});
      return;
    }
    console.error(`github-task-sync: syncIssueForTask(${taskId}) failed`, err);
  }
}

export async function closeIssueForTask(
  taskId: string,
  reason: "completed" | "not_planned",
): Promise<void> {
  try {
    const task = await loadTask(taskId);
    if (!task || !task.githubRepo || task.githubIssueNumber === null) return;

    const { owner, repo: name } = parseRepo(task.githubRepo, "closeIssueForTask");
    const number = task.githubIssueNumber;
    const gh = githubAppClient();

    markRecentOutbound(task.githubRepo, number);
    await gh.rest.issues.update({
      owner,
      repo: name,
      issue_number: number,
      state: "closed",
      state_reason: reason,
    });
    await applyStatusLabel(owner, name, number, reason === "completed" ? "Done" : "Cancelled");
  } catch (err) {
    if (isNotFound(err)) {
      await prisma.task
        .update({
          where: { id: taskId },
          data: { githubRepo: null, githubIssueNumber: null, githubIssueUrl: null },
        })
        .catch(() => {});
      return;
    }
    console.error(`github-task-sync: closeIssueForTask(${taskId}) failed`, err);
  }
}

// ─── Internals ──────────────────────────────────────────────────────────────

type TaskWithAssignees = {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  githubRepo: string | null;
  githubIssueNumber: number | null;
  assignees: { user: { firstName: string; lastName: string; githubUsername: string | null } }[];
};

async function loadTask(taskId: string): Promise<TaskWithAssignees | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      title: true,
      status: true,
      githubRepo: true,
      githubIssueNumber: true,
      assignees: {
        select: {
          user: { select: { firstName: true, lastName: true, githubUsername: true } },
        },
      },
    },
  });
  return task as TaskWithAssignees | null;
}

function resolveAssignees(
  rows: TaskWithAssignees["assignees"],
): { assignees: string[]; missing: string[] } {
  const assignees: string[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    if (row.user.githubUsername) assignees.push(row.user.githubUsername);
    else missing.push(`${row.user.firstName} ${row.user.lastName}`.trim());
  }
  return { assignees, missing };
}

async function applyStatusLabel(
  owner: string,
  repo: string,
  number: number,
  status: TaskStatus,
): Promise<void> {
  const want = STATUS_LABELS[status];
  const gh = githubAppClient();
  try {
    const cur = await gh.rest.issues.listLabelsOnIssue({ owner, repo, issue_number: number });
    const have = cur.data.map((l) => l.name);
    const toRemove = have.filter((n) => ALL_STATUS_LABELS.includes(n) && n !== want);
    for (const name of toRemove) {
      await gh.rest.issues
        .removeLabel({ owner, repo, issue_number: number, name })
        .catch((err) => {
          if (!isNotFound(err)) throw err;
        });
    }
    if (want && !have.includes(want)) {
      await gh.rest.issues.addLabels({
        owner,
        repo,
        issue_number: number,
        labels: [want],
      });
    }
  } catch (err) {
    console.error(`github-task-sync: applyStatusLabel(${owner}/${repo}#${number}) failed`, err);
  }
}

async function postMissingAssigneesComment(
  owner: string,
  repo: string,
  number: number,
  missing: string[],
): Promise<void> {
  // Dedupe so we don't repeat the same names on every sync.
  const marker = `<!-- dalios:missing-assignees:${missing.slice().sort().join("|")} -->`;
  const gh = githubAppClient();
  try {
    const existing = await gh.rest.issues.listComments({
      owner,
      repo,
      issue_number: number,
      per_page: 100,
    });
    if (existing.data.some((c) => c.body?.includes(marker))) return;

    const body = `${marker}\nAssigned in dalios but no GitHub handle on file: ${missing.join(", ")}.`;
    await gh.rest.issues.createComment({ owner, repo, issue_number: number, body });
  } catch (err) {
    console.error(
      `github-task-sync: postMissingAssigneesComment(${owner}/${repo}#${number}) failed`,
      err,
    );
  }
}
