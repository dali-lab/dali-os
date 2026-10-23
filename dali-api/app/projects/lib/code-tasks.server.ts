import { prisma } from "~/lib/db";
import { githubAppClient, isNotFound } from "~/lib/github";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { normalizeRepo } from "./github-task-sync";
import {
  CODE_TASK_DONE_ERROR,
  hasMergedPr,
  parsePullRequestUrl,
  pullRequestState,
  requiresMergedPr,
  type PullRequestModel,
  type PullRequestState,
} from "./code-tasks";

export const PULL_REQUEST_SELECT = {
  id: true,
  repo: true,
  number: true,
  url: true,
  title: true,
  state: true,
} as const;

export function codeTaskRuleActive(request?: Request): Promise<boolean> {
  return isFeatureEnabledForEveryone("code-task-prs", request);
}

type FetchedPr = { state: PullRequestState; title: string; url: string; mergedAt: Date | null };

/** The PR as GitHub has it now; null when it doesn't exist or the app can't see it. */
export async function fetchPullRequest(repo: string, number: number): Promise<FetchedPr | null> {
  const [owner, name] = repo.split("/");
  try {
    const { data } = await githubAppClient().pulls.get({ owner: owner!, repo: name!, pull_number: number });
    return {
      state: pullRequestState(data),
      title: data.title,
      url: data.html_url,
      mergedAt: data.merged_at ? new Date(data.merged_at) : null,
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export type AttachResult =
  | { ok: true; pullRequest: PullRequestModel }
  | { ok: false; status: number; error: string };

/** Attach a PR by URL: it must be in one of the project's repos and exist on GitHub. */
export async function attachPullRequest(taskId: string, rawUrl: string): Promise<AttachResult> {
  const parsed = parsePullRequestUrl(rawUrl);
  if (!parsed) return { ok: false, status: 400, error: "That isn't a GitHub pull request link" };
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { project: { select: { repoUrls: true } } },
  });
  if (!task) return { ok: false, status: 404, error: "Task not found" };
  const repos = task.project.repoUrls.map(normalizeRepo).filter((r): r is string => !!r);
  const repo = repos.find((r) => r.toLowerCase() === parsed.repo.toLowerCase());
  if (!repo) {
    return { ok: false, status: 400, error: "That pull request isn't in one of this project's repos" };
  }
  let fetched: FetchedPr | null;
  try {
    fetched = await fetchPullRequest(repo, parsed.number);
  } catch (err) {
    console.error(`task ${taskId}: GitHub PR lookup failed`, err);
    return { ok: false, status: 502, error: "Couldn't reach GitHub — try again" };
  }
  if (!fetched) return { ok: false, status: 404, error: "GitHub has no such pull request" };
  const row = await upsertPullRequest(taskId, repo, parsed.number, fetched);
  await prisma.task.update({ where: { id: taskId }, data: { activityAt: new Date() } });
  return { ok: true, pullRequest: toPullRequestModel(row) };
}

function upsertPullRequest(taskId: string, repo: string, number: number, pr: FetchedPr) {
  const data = { url: pr.url, title: pr.title, state: pr.state, mergedAt: pr.mergedAt, checkedAt: new Date() };
  return prisma.taskPullRequest.upsert({
    where: { taskId_repo_number: { taskId, repo, number } },
    create: { taskId, repo, number, ...data },
    update: data,
    select: PULL_REQUEST_SELECT,
  });
}

export function toPullRequestModel(r: {
  id: string;
  repo: string;
  number: number;
  url: string;
  title: string | null;
  state: string;
}): PullRequestModel {
  return { ...r, state: r.state as PullRequestState };
}

/**
 * Null when the task may move to Done, else the reason it can't. A code task
 * needs a merged PR; unmerged ones are re-checked against GitHub first, so a
 * PR merged since it was attached counts.
 */
export async function codeTaskDoneBlocker(taskId: string, request?: Request): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      isCodeTask: true,
      domain: { select: { code: true } },
      pullRequests: { select: { id: true, repo: true, number: true, state: true } },
    },
  });
  if (!task || !requiresMergedPr({ isCodeTask: task.isCodeTask, domainCode: task.domain?.code })) {
    return null;
  }
  if (!(await codeTaskRuleActive(request))) return null;
  if (hasMergedPr(task.pullRequests)) return null;
  for (const pr of task.pullRequests) {
    let fetched: FetchedPr | null = null;
    try {
      fetched = await fetchPullRequest(pr.repo, pr.number);
    } catch (err) {
      console.error(`task ${taskId}: GitHub PR re-check failed`, err);
      continue;
    }
    if (!fetched) continue;
    await upsertPullRequest(taskId, pr.repo, pr.number, fetched);
    if (fetched.state === "merged") return null;
  }
  return CODE_TASK_DONE_ERROR;
}

/**
 * Webhook side: keep stored PR states current, and attach a merged PR to the
 * tasks it references (closing-keyword issue refs, dali.os task links) when
 * those tasks are code tasks in a project that owns the repo.
 */
export async function recordPullRequestEvent(args: {
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  state: PullRequestState;
  mergedAt: Date | null;
  refs: { issueNumbers: number[]; taskIds: string[] };
}): Promise<string[]> {
  const fetched: FetchedPr = { state: args.state, title: args.title, url: args.url, mergedAt: args.mergedAt };
  const existing = await prisma.taskPullRequest.findMany({
    where: { repo: { equals: args.repo, mode: "insensitive" }, number: args.number },
    select: { taskId: true, repo: true },
  });
  for (const e of existing) await upsertPullRequest(e.taskId, e.repo, args.number, fetched);

  if (args.state !== "merged") return [];
  if (args.refs.issueNumbers.length === 0 && args.refs.taskIds.length === 0) return [];
  const candidates = await prisma.task.findMany({
    where: {
      isCodeTask: true,
      OR: [
        ...(args.refs.issueNumbers.length
          ? [{ githubRepo: args.repo, githubIssueNumber: { in: args.refs.issueNumbers } }]
          : []),
        ...(args.refs.taskIds.length ? [{ id: { in: args.refs.taskIds } }] : []),
      ],
    },
    select: { id: true, project: { select: { repoUrls: true } } },
  });
  const attached: string[] = [];
  for (const t of candidates) {
    const repo = t.project.repoUrls
      .map(normalizeRepo)
      .find((r) => r?.toLowerCase() === args.repo.toLowerCase());
    if (!repo) continue;
    await upsertPullRequest(t.id, repo, args.number, fetched);
    attached.push(t.id);
  }
  return attached;
}
