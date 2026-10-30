import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    scheduledJob: { findUnique: vi.fn(), update: vi.fn() },
    releaseNote: { findMany: vi.fn(), create: vi.fn() },
    aiUsage: { upsert: vi.fn() },
  },
}));
vi.mock("~/lib/app-env", () => ({ getAppEnv: vi.fn(() => "prod") }));
vi.mock("~/lib/feature-flags.server", () => ({ getFeatureFlagRows: vi.fn() }));
vi.mock("~/lib/github", () => ({ githubAppClient: vi.fn(), parseRepo: (v: string) => {
  const [owner, repo] = v.split("/");
  return { owner, repo };
} }));
vi.mock("~/lib/ai.server", () => ({
  generateShortText: vi.fn(),
  resolveAiProvider: vi.fn(() => ({ sonnetModel: "sonnet-x" })),
}));
vi.mock("~/lib/ai-usage.server", () => ({ recordTokenUsage: vi.fn() }));
vi.mock("~/lib/s3", () => ({ listObjectKeys: vi.fn(async () => []) }));

import { prisma } from "~/lib/db.server";
import { getAppEnv } from "~/lib/app-env";
import { getFeatureFlagRows } from "~/lib/feature-flags.server";
import { githubAppClient } from "~/lib/github";
import { generateShortText } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { listObjectKeys } from "~/lib/s3";
import { runReleaseNotesDraft } from "../release-notes-draft.server";

const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const gh = {
  rest: {
    repos: {
      getBranch: vi.fn(),
      compareCommitsWithBasehead: vi.fn(),
    },
    pulls: { get: vi.fn(), listFiles: vi.fn() },
  },
};

const ghPr = (n: number, o: Record<string, unknown> = {}) => ({
  number: n,
  title: `PR ${n}`,
  body: "## Release note\nSomething members can use.",
  labels: [],
  merged_at: "2026-10-20T00:00:00Z",
  base: { ref: "staging" },
  ...o,
});

function setup({
  lastSha,
  head = "head1",
  commits = ["Ship it (#10)"],
  prs = [],
}: {
  lastSha: string | null;
  head?: string;
  commits?: string[];
  prs?: ReturnType<typeof ghPr>[];
}) {
  p.scheduledJob.findUnique.mockResolvedValue({ state: lastSha ? { lastSha } : null });
  gh.rest.repos.getBranch.mockResolvedValue({ data: { commit: { sha: head } } });
  gh.rest.repos.compareCommitsWithBasehead.mockResolvedValue({
    data: { commits: commits.map((message) => ({ commit: { message } })) },
  });
  gh.rest.pulls.get.mockImplementation(async ({ pull_number }: { pull_number: number }) => {
    const pr = prs.find((x) => x.number === pull_number);
    if (!pr) throw new Error(`no PR ${pull_number}`);
    return { data: pr };
  });
  gh.rest.pulls.listFiles.mockResolvedValue({ data: [{ filename: "a.ts", additions: 2, deletions: 1 }] });
}

const entry = (prNumbers: number[]) => ({
  title: "New thing",
  summary: "You can do a thing.",
  body: "Para one.\n\nPara two.",
  area: "drive",
  prNumbers,
  uncertain: false,
  uncertainReason: null,
});
const aiReturns = (text: string) =>
  vi.mocked(generateShortText).mockResolvedValue({ text, inputTokens: 10, outputTokens: 5 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppEnv).mockReturnValue("prod");
  vi.mocked(getFeatureFlagRows).mockResolvedValue(new Map([["release-notes", { enabled: true }]]) as never);
  vi.mocked(githubAppClient).mockReturnValue(gh as never);
  p.releaseNote.findMany.mockResolvedValue([]);
  p.releaseNote.create.mockResolvedValue({});
  vi.mocked(listObjectKeys).mockResolvedValue([]);
});

describe("runReleaseNotesDraft", () => {
  it("does nothing outside prod", async () => {
    vi.mocked(getAppEnv).mockReturnValue("staging");
    expect((await runReleaseNotesDraft()).note).toBe("prod only");
    expect(gh.rest.repos.getBranch).not.toHaveBeenCalled();
  });

  it("does nothing when the flag is off or missing", async () => {
    vi.mocked(getFeatureFlagRows).mockResolvedValue(new Map([["release-notes", { enabled: false }]]) as never);
    expect((await runReleaseNotesDraft()).note).toMatch(/flag is off/);
    vi.mocked(getFeatureFlagRows).mockResolvedValue(new Map() as never);
    expect((await runReleaseNotesDraft()).note).toMatch(/flag is off/);
    expect(gh.rest.repos.getBranch).not.toHaveBeenCalled();
  });

  it("records the head on the first run and drafts nothing", async () => {
    setup({ lastSha: null });
    const res = await runReleaseNotesDraft();
    expect(res.note).toMatch(/first run/);
    expect(p.scheduledJob.update).toHaveBeenCalledWith({
      where: { name: "release-notes-draft" },
      data: { state: { lastSha: "head1" } },
    });
    expect(gh.rest.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("is a no-op when prod has not moved", async () => {
    setup({ lastSha: "head1" });
    expect((await runReleaseNotesDraft()).note).toBe("no promotion");
    expect(p.scheduledJob.update).not.toHaveBeenCalled();
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("drafts from merged PRs, records usage, and advances the cursor last", async () => {
    setup({
      lastSha: "old",
      commits: ["A (#10)", "B (#11)"],
      prs: [ghPr(10), ghPr(11, { body: "## Release note\n<!-- empty -->" })],
    });
    aiReturns("```json\n" + JSON.stringify([entry([10])]) + "\n```");
    const res = await runReleaseNotesDraft();

    expect(res.items).toBe(1);
    expect(gh.rest.repos.compareCommitsWithBasehead.mock.calls[0][0].basehead).toBe("old...head1");
    expect(vi.mocked(generateShortText).mock.calls[0][0].prompt).toContain('number="10"');
    expect(vi.mocked(generateShortText).mock.calls[0][0].prompt).not.toContain('number="11"');
    expect(vi.mocked(generateShortText).mock.calls[0][0].model).toBe("sonnet-x");
    expect(recordTokenUsage).toHaveBeenCalledWith("system:release-notes-draft", expect.any(String), 10, 5);

    const data = p.releaseNote.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: "Draft",
      prNumbers: [10],
      area: "drive",
      allMembers: true,
      draftNote: null,
    });
    expect(data.contentJson).toHaveLength(2);
    expect(data.videoKey).toBeUndefined();
    expect(p.scheduledJob.update).toHaveBeenCalledWith({
      where: { name: "release-notes-draft" },
      data: { state: { lastSha: "head1" } },
    });
  });

  it("skips PRs already cited by any note and PRs into prod, and advances without calling the model", async () => {
    setup({
      lastSha: "old",
      commits: ["A (#10)", "Promote (#12)"],
      prs: [ghPr(10), ghPr(12, { base: { ref: "prod" } })],
    });
    p.releaseNote.findMany.mockResolvedValue([{ prNumbers: [10] }]);
    const res = await runReleaseNotesDraft();
    expect(res.items).toBe(0);
    expect(generateShortText).not.toHaveBeenCalled();
    expect(p.scheduledJob.update).toHaveBeenCalledTimes(1);
  });

  it("looks each PR up by the number in its commit subject, once", async () => {
    setup({
      lastSha: "old",
      commits: ["A (#10)", "Revert A (#10)", "Merge pull request #11 from x/y\n\nbody (#99)", "Direct push"],
      prs: [ghPr(10), ghPr(11)],
    });
    aiReturns("[]");
    await runReleaseNotesDraft();
    expect(gh.rest.pulls.get.mock.calls.map((c) => c[0].pull_number)).toEqual([10, 11]);
    expect(gh.rest.pulls.listFiles).toHaveBeenCalledTimes(2);
    expect(p.scheduledJob.update).toHaveBeenCalledTimes(1);
  });

  it("skips unmerged PRs", async () => {
    setup({ lastSha: "old", prs: [ghPr(10, { merged_at: null })] });
    await runReleaseNotesDraft();
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("does not advance the cursor when a PR lookup fails", async () => {
    setup({ lastSha: "old", commits: ["A (#10)"], prs: [] });
    await expect(runReleaseNotesDraft()).rejects.toThrow(/no PR 10/);
    expect(p.scheduledJob.update).not.toHaveBeenCalled();
  });

  it("makes one model call per 40 PRs", async () => {
    const prs = Array.from({ length: 41 }, (_, i) => ghPr(i + 1));
    setup({ lastSha: "old", commits: prs.map((pr) => `PR (#${pr.number})`), prs });
    aiReturns("[]");
    await runReleaseNotesDraft();
    expect(generateShortText).toHaveBeenCalledTimes(2);
  });

  it("stores the uncertainty reason and attaches a scripted capture", async () => {
    setup({ lastSha: "old", prs: [ghPr(10)] });
    aiReturns(JSON.stringify([{ ...entry([10]), area: "bogus", uncertain: true, uncertainReason: "Might be internal" }]));
    vi.mocked(listObjectKeys).mockResolvedValue(["release-notes/pr-10/demo.mp4"]);
    await runReleaseNotesDraft();
    expect(listObjectKeys).toHaveBeenCalledWith("release-notes/pr-10/");
    expect(p.releaseNote.create.mock.calls[0][0].data).toMatchObject({
      area: null,
      draftNote: "Might be internal",
      videoKey: "release-notes/pr-10/demo.mp4",
      videoSource: "scripted",
    });
  });

  it("does not advance the cursor when the model output is not JSON", async () => {
    setup({ lastSha: "old", prs: [ghPr(10)] });
    aiReturns("Sorry, I cannot.");
    await expect(runReleaseNotesDraft()).rejects.toThrow(/JSON array/);
    expect(p.releaseNote.create).not.toHaveBeenCalled();
    expect(p.scheduledJob.update).not.toHaveBeenCalled();
  });

  it("does not advance the cursor when no AI provider is configured", async () => {
    setup({ lastSha: "old", prs: [ghPr(10)] });
    vi.mocked(generateShortText).mockResolvedValue(null);
    await expect(runReleaseNotesDraft()).rejects.toThrow(/provider/);
    expect(p.scheduledJob.update).not.toHaveBeenCalled();
  });

  it("drops entries citing PRs outside the input", async () => {
    setup({ lastSha: "old", prs: [ghPr(10)] });
    aiReturns(JSON.stringify([entry([99])]));
    expect((await runReleaseNotesDraft()).items).toBe(0);
    expect(p.releaseNote.create).not.toHaveBeenCalled();
  });
});
