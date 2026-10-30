import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { getAppEnv } from "~/lib/app-env";
import { getFeatureFlagRows } from "~/lib/feature-flags.server";
import { githubAppClient, parseRepo } from "~/lib/github";
import { generateShortText, resolveAiProvider } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { listObjectKeys } from "~/lib/s3";
import type { JobResult } from "~/jobs/registry";
import {
  MAX_COMMITS,
  PRS_PER_CALL,
  FILES_MAX,
  DRAFT_SYSTEM_PROMPT,
  bodyToBlocks,
  buildDraftPrompt,
  chunk,
  decideCursor,
  parseDraftEntries,
  pickCaptureVideoKey,
  prNumbersFromCommitMessages,
  selectPrsToDraft,
  type PullForPrompt,
  type PullSummary,
} from "~/lib/release-notes-draft";
import { RELEASE_NOTE_CAPTURE_KEY_PREFIX } from "~/lib/release-notes";

const JOB_NAME = "release-notes-draft";
const PROMOTION_BRANCH = "prod";
const AI_USER_ID = "system:release-notes-draft";
const DEFAULT_REPO = "dali-lab/dali-os";
const MAX_OUTPUT_TOKENS = 8000;
const LOOKUP_CONCURRENCY = 5;

type Octokit = ReturnType<typeof githubAppClient>;

async function readLastSha(): Promise<string | null> {
  const row = await prisma.scheduledJob.findUnique({
    where: { name: JOB_NAME },
    select: { state: true },
  });
  const sha = (row?.state as { lastSha?: unknown } | null)?.lastSha;
  return typeof sha === "string" ? sha : null;
}

async function writeLastSha(lastSha: string) {
  await prisma.scheduledJob.update({
    where: { name: JOB_NAME },
    data: { state: { lastSha } satisfies Prisma.InputJsonObject },
  });
}

async function commitMessages(gh: Octokit, repo: { owner: string; repo: string }, base: string, head: string) {
  const messages: string[] = [];
  for (let page = 1; messages.length < MAX_COMMITS; page++) {
    const { data } = await gh.rest.repos.compareCommitsWithBasehead({
      ...repo,
      basehead: `${base}...${head}`,
      per_page: 100,
      page,
    });
    messages.push(...data.commits.map((c) => c.commit.message));
    if (data.commits.length < 100) break;
  }
  return messages.slice(0, MAX_COMMITS);
}

// Not listPullRequestsAssociatedWithCommit: it returns a bodiless 500 for the
// app installation token on commits that resolve fine with a user token.
async function pullsByNumber(
  gh: Octokit,
  repo: { owner: string; repo: string },
  numbers: number[],
): Promise<PullSummary[]> {
  const prs: PullSummary[] = [];
  for (const group of chunk(numbers, LOOKUP_CONCURRENCY)) {
    const results = await Promise.all(
      group.map((pull_number) => gh.rest.pulls.get({ ...repo, pull_number })),
    );
    for (const { data: pr } of results) {
      prs.push({
        number: pr.number,
        title: pr.title,
        body: pr.body,
        labels: pr.labels.map((l) => l.name ?? ""),
        mergedAt: pr.merged_at,
        baseRef: pr.base.ref,
      });
    }
  }
  return prs;
}

async function withFiles(
  gh: Octokit,
  repo: { owner: string; repo: string },
  prs: PullSummary[],
): Promise<PullForPrompt[]> {
  const out: PullForPrompt[] = [];
  for (const group of chunk(prs, LOOKUP_CONCURRENCY)) {
    const results = await Promise.all(
      group.map((pr) =>
        gh.rest.pulls.listFiles({ ...repo, pull_number: pr.number, per_page: FILES_MAX }),
      ),
    );
    group.forEach((pr, i) => {
      const files = results[i].data;
      out.push({
        ...pr,
        files: files.map((f) => f.filename),
        additions: files.reduce((n, f) => n + f.additions, 0),
        deletions: files.reduce((n, f) => n + f.deletions, 0),
      });
    });
  }
  return out;
}

async function captureKeysByPr(prNumbers: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  await Promise.all(
    prNumbers.map(async (n) => {
      const keys = await listObjectKeys(`${RELEASE_NOTE_CAPTURE_KEY_PREFIX}${n}/`).catch(() => []);
      map.set(n, keys);
    }),
  );
  return map;
}

async function draftChunk(prs: PullForPrompt[]): Promise<number> {
  const result = await generateShortText({
    system: DRAFT_SYSTEM_PROMPT,
    prompt: buildDraftPrompt(prs),
    maxTokens: MAX_OUTPUT_TOKENS,
    model: resolveAiProvider()?.sonnetModel,
  });
  if (!result) throw new Error("No AI provider is configured");

  const day = new Date().toISOString().slice(0, 10);
  await prisma.aiUsage.upsert({
    where: { userId_day: { userId: AI_USER_ID, day } },
    create: { userId: AI_USER_ID, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  await recordTokenUsage(AI_USER_ID, day, result.inputTokens, result.outputTokens);

  const entries = parseDraftEntries(result.text, new Set(prs.map((p) => p.number)));
  if (!entries) throw new Error("The model did not return a JSON array");
  const keysByPr = await captureKeysByPr([...new Set(entries.flatMap((e) => e.prNumbers))]);
  for (const entry of entries) {
    const videoKey = pickCaptureVideoKey(keysByPr, entry.prNumbers);
    await prisma.releaseNote.create({
      data: {
        status: "Draft",
        title: entry.title,
        summary: entry.summary,
        area: entry.area,
        prNumbers: entry.prNumbers,
        allMembers: true,
        draftNote: entry.uncertainReason,
        contentJson: bodyToBlocks(entry.body) as Prisma.InputJsonValue,
        ...(videoKey ? { videoKey, videoSource: "scripted" } : {}),
      },
    });
  }
  return entries.length;
}

export async function runReleaseNotesDraft(): Promise<JobResult> {
  if (getAppEnv() !== "prod") return { items: 0, note: "prod only" };
  const flag = (await getFeatureFlagRows()).get("release-notes");
  if (!flag?.enabled) return { items: 0, note: "release-notes flag is off" };

  const repo = parseRepo(process.env.RELEASE_NOTES_REPO || DEFAULT_REPO, "RELEASE_NOTES_REPO");
  const gh = githubAppClient();
  const { data: branch } = await gh.rest.repos.getBranch({ ...repo, branch: PROMOTION_BRANCH });
  const decision = decideCursor(await readLastSha(), branch.commit.sha);

  if (decision.action === "skip") return { items: 0, note: "no promotion" };
  if (decision.action === "record") {
    await writeLastSha(decision.sha);
    return { items: 0, note: "first run, recorded the current prod sha" };
  }

  const messages = await commitMessages(gh, repo, decision.base, decision.head);
  const found = await pullsByNumber(gh, repo, prNumbersFromCommitMessages(messages));
  const cited = new Set(
    (await prisma.releaseNote.findMany({ select: { prNumbers: true } })).flatMap((n) => n.prNumbers),
  );
  const toDraft = selectPrsToDraft(found, { citedPrNumbers: cited, promotionBranch: PROMOTION_BRANCH });

  let drafted = 0;
  for (const group of chunk(toDraft, PRS_PER_CALL)) {
    drafted += await draftChunk(await withFiles(gh, repo, group));
  }

  await writeLastSha(decision.head);
  return { items: drafted, note: `${toDraft.length} PRs reviewed` };
}
