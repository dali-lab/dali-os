import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { project: { findMany: vi.fn() }, sprint: { findFirst: vi.fn() } },
}));
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn().mockReturnValue(true),
  postMessage: vi.fn().mockResolvedValue({ ts: "1" }),
}));
vi.mock("~/lib/notify.server", () => ({
  notify: vi.fn().mockResolvedValue({ inApp: 2, emailed: 0, slackDmed: 0 }),
}));
vi.mock("~/projects/lib/project-members.server", () => ({
  currentProjectParticipantIds: vi.fn().mockResolvedValue(new Set(["u1", "u2"])),
}));
vi.mock("~/jobs/job-slack", () => ({ jobChannelPostAllowed: vi.fn().mockReturnValue(true) }));
vi.mock("~/projects/lib/sprints.server", () => ({
  ensureSprints: vi.fn().mockResolvedValue(undefined),
  closeEndedSprints: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import { postMessage } from "~/slack/lib/slack-client";
import { notify } from "~/lib/notify.server";
import { closeEndedSprints, ensureSprints } from "~/projects/lib/sprints.server";
import { runSprintLifecycle, wrapUpSummary } from "~/jobs/sprint-lifecycle.server";

const mocked = (f: unknown) => f as ReturnType<typeof vi.fn>;
const findProjects = mocked(prisma.project.findMany);
const findSprint = mocked(prisma.sprint.findFirst);

// 10:00 ET Tue 2026-10-13 (after the nudge hour) and 08:00 ET (before it).
const MORNING = new Date("2026-10-13T14:00:00Z");
const EARLY = new Date("2026-10-13T12:00:00Z");
const run = (now = MORNING) => runSprintLifecycle({ now, lastSuccessAt: null, settings: {} });

const project = (extra = {}) => ({
  id: "p1",
  name: "DALI OS",
  status: "Active",
  slackChannelId: "C1",
  ...extra,
});

const closed = (extra = {}) => ({
  id: "s3",
  number: 3,
  termId: "26F",
  startsOn: new Date("2026-09-30"),
  endsOn: new Date("2026-10-06"),
  planned: 4,
  completed: 3,
  carried: 1,
  nextSprintId: "s4",
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  findProjects.mockResolvedValue([project()]);
  findSprint.mockResolvedValue(null);
  mocked(notify).mockResolvedValue({ inApp: 2, emailed: 0, slackDmed: 0 });
  mocked(closeEndedSprints).mockResolvedValue([]);
});

describe("wrapUpSummary", () => {
  it("mentions rolled work only when there is some", () => {
    expect(wrapUpSummary({ planned: 1, completed: 1, carried: 0 })).toBe("1 of 1 task done.");
    expect(wrapUpSummary({ planned: 4, completed: 3, carried: 1 })).toBe(
      "3 of 4 tasks done. 1 rolled to the next sprint.",
    );
  });
});

describe("runSprintLifecycle", () => {
  it("ensures and closes sprints for every selected project", async () => {
    await run();
    expect(ensureSprints).toHaveBeenCalledWith("p1", MORNING);
    expect(closeEndedSprints).toHaveBeenCalledWith("p1", MORNING);
  });

  it("posts one wrap-up (in-app + Slack) for the latest closed sprint", async () => {
    mocked(closeEndedSprints).mockResolvedValue([closed({ id: "s2", number: 2 }), closed()]);
    const res = await run();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(mocked(notify).mock.calls[0]![0]).toMatchObject({
      eventType: "project.sprint_closed",
      message: {
        vars: { itemTitle: "Sprint 3", contextName: "DALI OS", itemDetail: "3 of 4 tasks done. 1 rolled to the next sprint." },
        dedupKey: "sprint-closed:p1:s3",
      },
      recipients: [{ userId: "u1" }, { userId: "u2" }],
    });
    expect(postMessage).toHaveBeenCalledWith("C1", expect.stringContaining("*Sprint 3* wrapped up"));
    expect(res.items).toBe(1);
  });

  it("skips Slack when the dedupKey was already claimed", async () => {
    mocked(closeEndedSprints).mockResolvedValue([closed()]);
    mocked(notify).mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 });
    await run();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not announce an empty sprint", async () => {
    mocked(closeEndedSprints).mockResolvedValue([closed({ planned: 0, completed: 0, carried: 0 })]);
    await run();
    expect(notify).not.toHaveBeenCalled();
  });

  it("closes but stays quiet for inactive projects (backfill sweep)", async () => {
    findProjects.mockResolvedValue([project({ status: "Completed" })]);
    mocked(closeEndedSprints).mockResolvedValue([closed()]);
    await run();
    expect(closeEndedSprints).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(findSprint).not.toHaveBeenCalled();
  });

  it("nudges each assignee with their unfinished count on the sprint's last day", async () => {
    findSprint.mockResolvedValue({
      id: "s4",
      number: 4,
      tasks: [
        { assignees: [{ userId: "u1" }, { userId: "u2" }] },
        { assignees: [{ userId: "u1" }] },
        { assignees: [] },
      ],
    });
    await run();
    expect(findSprint.mock.calls[0]![0].where).toMatchObject({
      projectId: "p1",
      closedAt: null,
      endsOn: new Date("2026-10-13T00:00:00Z"),
    });
    const calls = mocked(notify).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      eventType: "project.sprint_ending",
      message: { vars: { itemDetail: "Ends today — 2 unfinished tasks." }, dedupKey: "sprint-ending:s4:u1" },
      recipients: [{ userId: "u1" }],
    });
    expect(calls[1]).toMatchObject({
      message: { vars: { itemDetail: "Ends today — 1 unfinished task." }, dedupKey: "sprint-ending:s4:u2" },
    });
  });

  it("holds the nudge until the morning", async () => {
    await run(EARLY);
    expect(findSprint).not.toHaveBeenCalled();
  });

  it("isolates a failing project", async () => {
    findProjects.mockResolvedValue([project({ id: "bad" }), project({ id: "p2" })]);
    mocked(ensureSprints).mockRejectedValueOnce(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run();
    expect(closeEndedSprints).toHaveBeenCalledWith("p2", MORNING);
    expect(res.note).toMatch(/1 project/);
    err.mockRestore();
  });
});
