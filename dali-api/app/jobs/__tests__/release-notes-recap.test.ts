import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { releaseNote: { findMany: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "ob1", deduped: false })),
  drainNow: vi.fn(),
}));
vi.mock("~/lib/app-env", () => ({ getFrontendUrl: () => "https://os.example" }));
vi.mock("~/lib/release-notes.server", () => ({
  releaseNotesSlackChannel: vi.fn(() => "C999"),
}));

import { prisma } from "~/lib/db";
import { enqueueOutbound } from "~/lib/outbound.server";
import { releaseNotesSlackChannel } from "~/lib/release-notes.server";
import { runReleaseNotesRecap } from "../release-notes-recap.server";

const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const settings = { weekday: 4, hour: 10 };
const due = new Date("2026-10-22T14:30:00Z");

const published = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  title: `T${id}`,
  summary: `S${id}`,
  area: "drive",
  highlight: false,
  allMembers: true,
  groupIds: [],
  ...o,
});
const draft = (id: string, ageDays: number, o: Record<string, unknown> = {}) => ({
  id,
  title: `D${id}`,
  allMembers: true,
  groupIds: [],
  draftedAt: new Date(due.getTime() - ageDays * 86_400_000),
  ...o,
});

function seed(drafts: unknown[], notes: unknown[]) {
  p.releaseNote.findMany.mockResolvedValueOnce(drafts).mockResolvedValueOnce(notes);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(releaseNotesSlackChannel).mockReturnValue("C999");
  p.releaseNote.updateMany.mockResolvedValue({ count: 0 });
});

describe("runReleaseNotesRecap", () => {
  it("does nothing outside the window", async () => {
    const res = await runReleaseNotesRecap({
      now: new Date("2026-10-22T13:00:00Z"),
      lastSuccessAt: null,
      settings,
    });
    expect(res.note).toBe("not due");
    expect(p.releaseNote.findMany).not.toHaveBeenCalled();
  });

  it("does nothing when it already ran this week", async () => {
    const res = await runReleaseNotesRecap({
      now: due,
      lastSuccessAt: new Date("2026-10-22T14:05:00Z"),
      settings,
    });
    expect(res.note).toBe("not due");
  });

  it("posts one keyed recap, marks the week, and dismisses only drafts older than 7 days", async () => {
    seed([draft("old", 8), draft("edge", 7), draft("new", 1)], [published("a"), published("b")]);
    await runReleaseNotesRecap({ now: due, lastSuccessAt: null, settings });

    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    const args = vi.mocked(enqueueOutbound).mock.calls[0][0];
    expect(args).toMatchObject({
      channel: "slack_channel",
      target: "C999",
      dedupKey: "release-notes-recap:2026-W43",
    });
    expect(JSON.stringify(args.slackBlocks)).toContain("Dold");
    expect(JSON.stringify(args.slackBlocks)).not.toContain("Dedge");

    expect(p.releaseNote.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["old"] }, status: "Draft" },
      data: { status: "Dismissed" },
    });
    expect(p.releaseNote.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, recapWeek: null },
      data: { recapWeek: "2026-W43" },
    });
  });

  it("keeps restricted entries out of Slack but still marks them recapped", async () => {
    seed(
      [draft("dr", 9, { allMembers: false, groupIds: ["g1"] })],
      [published("a"), published("r", { allMembers: false, groupIds: ["g1"] })],
    );
    await runReleaseNotesRecap({ now: due, lastSuccessAt: null, settings });
    const blocks = JSON.stringify(vi.mocked(enqueueOutbound).mock.calls[0][0].slackBlocks);
    expect(blocks).toContain("Ta");
    expect(blocks).not.toContain("Tr");
    expect(blocks).not.toContain("Ddr");
    expect(p.releaseNote.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "r"] }, recapWeek: null },
      data: { recapWeek: "2026-W43" },
    });
  });

  it("posts nothing when only restricted entries exist, but still marks them", async () => {
    seed([], [published("r", { allMembers: false, groupIds: ["g1"] })]);
    await runReleaseNotesRecap({ now: due, lastSuccessAt: null, settings });
    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(p.releaseNote.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["r"] }, recapWeek: null },
      data: { recapWeek: "2026-W43" },
    });
  });

  it("still marks the week and dismisses drafts when no channel is configured", async () => {
    vi.mocked(releaseNotesSlackChannel).mockReturnValue(null);
    seed([draft("old", 8)], [published("a")]);
    await runReleaseNotesRecap({ now: due, lastSuccessAt: null, settings });
    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(p.releaseNote.updateMany).toHaveBeenCalledTimes(2);
  });

  it("is a no-op with nothing to recap", async () => {
    seed([draft("new", 1)], []);
    const res = await runReleaseNotesRecap({ now: due, lastSuccessAt: null, settings });
    expect(res.note).toBe("nothing to recap");
    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(p.releaseNote.updateMany).not.toHaveBeenCalled();
  });
});
