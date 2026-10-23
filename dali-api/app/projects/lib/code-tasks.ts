// Pure rules for code tasks: Fullstack tasks flagged isCodeTask need at least
// one merged pull request before they can move to Done.

/** Domain.code of the only domain whose tasks can be code tasks. */
export const CODE_TASK_DOMAIN = "Fullstack";

export const CODE_TASK_DONE_ERROR =
  "This is a code task — attach a merged pull request before moving it to Done.";

export type PullRequestState = "open" | "closed" | "merged";

export type PullRequestModel = {
  id: string;
  repo: string;
  number: number;
  url: string;
  title: string | null;
  state: PullRequestState;
};

/** Whether a task can be marked a code task: only Fullstack-domain tasks. */
export function canBeCodeTask(domainCode: string | null | undefined): boolean {
  return domainCode === CODE_TASK_DOMAIN;
}

/** Whether moving this task to Done needs a merged PR. */
export function requiresMergedPr(task: {
  isCodeTask: boolean;
  domainCode: string | null | undefined;
}): boolean {
  return task.isCodeTask && canBeCodeTask(task.domainCode);
}

export function hasMergedPr(prs: { state: string }[]): boolean {
  return prs.some((p) => p.state === "merged");
}

/** owner/repo#number from a github.com pull request URL, else null. */
export function parsePullRequestUrl(raw: string): { repo: string; number: number } | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(
    raw.trim(),
  );
  if (!m) return null;
  return { repo: `${m[1]}/${m[2]}`, number: Number(m[3]) };
}

export function pullRequestState(pr: { state: string; merged?: boolean | null; merged_at?: string | null }): PullRequestState {
  if (pr.merged || pr.merged_at) return "merged";
  return pr.state === "closed" ? "closed" : "open";
}

/**
 * Tasks a pull request's title/body points at: issue numbers after a closing
 * keyword ("Closes #12", "fixes owner/repo#12" for the same repo), and dali.os
 * task links (`...?task=<id>`).
 */
export function extractTaskRefs(
  text: string,
  repo: string,
): { issueNumbers: number[]; taskIds: string[] } {
  const issueNumbers = new Set<number>();
  const keyword = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)/gi;
  for (const m of text.matchAll(keyword)) {
    if (m[1] && m[1].toLowerCase() !== repo.toLowerCase()) continue;
    issueNumbers.add(Number(m[2]));
  }
  const taskIds = new Set<string>();
  for (const m of text.matchAll(/\/projects\/[^\s/?#]+\?[^\s)]*\btask=([a-z0-9]+)/gi)) {
    taskIds.add(m[1]!);
  }
  return { issueNumbers: [...issueNumbers], taskIds: [...taskIds] };
}
