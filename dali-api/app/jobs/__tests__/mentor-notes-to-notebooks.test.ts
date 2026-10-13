import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    groupDefinition: { findUnique: vi.fn() },
    mentorNote: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn() }));
vi.mock("~/mentorship/lib/pair-notebook.server", () => ({ ensureMentorNotePage: vi.fn() }));

import { prisma } from "~/lib/db";
import { resolveGroupMembers } from "~/lib/groups";
import { ensureMentorNotePage } from "~/mentorship/lib/pair-notebook.server";
import { MENTOR_NOTE_BATCH, runMentorNotesToNotebooks } from "~/jobs/mentor-notes-to-notebooks.server";
import { JOBS } from "~/jobs/registry";

const m = prisma as any;
const note = (id: string) => ({ id, mentorId: "m", pageId: null, contentJson: {} });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.groupDefinition.findUnique.mockResolvedValue({ id: "g_core" });
  vi.mocked(resolveGroupMembers).mockResolvedValue(["u_b", "u_a"]);
  m.mentorNote.findMany.mockResolvedValue([]);
  m.mentorNote.count.mockResolvedValue(0);
  vi.mocked(ensureMentorNotePage).mockResolvedValue({ pageId: "p" });
});

describe("mentor-notes-to-notebooks registration", () => {
  it("is registered, off by default, and runs every minute until done", () => {
    const job = JOBS.find((j) => j.name === "mentor-notes-to-notebooks");
    expect(job?.enabledByDefault).toBe(false);
    expect(job?.intervalMinutes).toBe(1);
  });
});

describe("runMentorNotesToNotebooks", () => {
  it("takes one batch of unmigrated notes", async () => {
    await runMentorNotesToNotebooks();

    expect(m.mentorNote.findMany).toHaveBeenCalledTimes(1);
    expect(m.mentorNote.findMany.mock.calls[0][0]).toMatchObject({
      where: { pageId: null },
      take: MENTOR_NOTE_BATCH,
    });
    expect(MENTOR_NOTE_BATCH).toBe(200);
  });

  it("migrates each note as the first Core member by id", async () => {
    m.mentorNote.findMany.mockResolvedValue([note("n1"), note("n2")]);

    const res = await runMentorNotesToNotebooks();

    expect(ensureMentorNotePage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ensureMentorNotePage).mock.calls.map((c) => [c[0].id, c[1]])).toEqual([
      ["n1", "u_a"],
      ["n2", "u_a"],
    ]);
    expect(res.items).toBe(2);
    expect(res.note).toBe("migrated 2, skipped 0, remaining 0");
  });

  it("counts a failing note as skipped and carries on with the rest", async () => {
    m.mentorNote.findMany.mockResolvedValue([note("n1"), note("n2"), note("n3")]);
    vi.mocked(ensureMentorNotePage).mockImplementation(async (n) => {
      if (n.id === "n2") throw new Error("boom");
      return { pageId: "p" };
    });
    m.mentorNote.count.mockResolvedValue(1);

    const res = await runMentorNotesToNotebooks();

    expect(res.items).toBe(2);
    expect(res.note).toBe("migrated 2, skipped 1, remaining 1");
  });

  it("is a no-op once every note has a page", async () => {
    const res = await runMentorNotesToNotebooks();

    expect(ensureMentorNotePage).not.toHaveBeenCalled();
    expect(res).toEqual({ items: 0, note: "migrated 0, skipped 0, remaining 0" });
  });

  it("aborts without touching notes when there is no Core group", async () => {
    m.groupDefinition.findUnique.mockResolvedValue(null);

    const res = await runMentorNotesToNotebooks();

    expect(m.mentorNote.findMany).not.toHaveBeenCalled();
    expect(res).toEqual({ items: 0, note: "Aborted: the Core group does not exist" });
  });

  it("aborts when there are no current Core members", async () => {
    vi.mocked(resolveGroupMembers).mockResolvedValue([]);

    const res = await runMentorNotesToNotebooks();

    expect(m.mentorNote.findMany).not.toHaveBeenCalled();
    expect(res.note).toContain("Aborted");
  });
});
