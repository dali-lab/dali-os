import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    releaseNote: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    outboundMessage: { findMany: vi.fn() },
    user: { update: vi.fn() },
  },
}));
vi.mock("~/lib/layout-cache.server", () => ({ invalidateLayoutCache: vi.fn() }));
vi.mock("~/lib/auth", () => ({}));
vi.mock("~/lib/login-next", () => ({}));
vi.mock("~/lib/roles", () => ({}));
vi.mock("~/lib/feature-flags.server", () => ({}));
vi.mock("~/lib/s3", () => ({ copyObject: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "ob1", deduped: false })),
  drainNow: vi.fn(),
}));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/app-env", () => ({ getFrontendUrl: () => "https://os.example" }));
vi.mock("~/lib/groups", () => ({
  listVisibleGroupIdsForUser: vi.fn(),
  resolveAllLabMembers: vi.fn(async () => ["u1", "u2"]),
  resolveGroupMembers: vi.fn(async (g: string) => (g === "g1" ? ["u2", "u3"] : ["u4"])),
}));

import { prisma } from "~/lib/db.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { notify } from "~/lib/notify.server";
import { copyObject } from "~/lib/s3";
import { invalidateLayoutCache } from "~/lib/layout-cache.server";
import {
  markReleaseNotesSeen,
  publishReleaseNotes,
  releaseNoteSlackStatuses,
} from "../release-notes.server";

const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const request = new Request("https://os.example");

const note = (o: Record<string, unknown>) => ({
  id: "n1",
  title: "Room holds",
  summary: "Hold rooms.",
  area: "calendar",
  highlight: false,
  allMembers: true,
  groupIds: [],
  videoKey: null,
  ...o,
});

function publish(notes: ReturnType<typeof note>[]) {
  p.releaseNote.findMany
    .mockResolvedValueOnce(notes.map((n) => ({ id: n.id, summary: n.summary, videoKey: n.videoKey })))
    .mockResolvedValueOnce(notes);
  return publishReleaseNotes(
    notes.map((n) => n.id),
    "admin",
    request,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RELEASE_NOTES_SLACK_CHANNEL_ID", "C999");
  p.releaseNote.updateMany.mockResolvedValue({ count: 1 });
});

describe("publishReleaseNotes slack delivery", () => {
  it("enqueues one keyed channel post for an all-members entry", async () => {
    await publish([note({ videoKey: "release-notes/uploads/a.mp4" })]);
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(enqueueOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "slack_channel",
        target: "C999",
        dedupKey: "release-note:n1",
        slackFileKey: "release-notes/uploads/a.mp4",
        slackText: "Room holds",
      }),
    );
    expect(drainNow).toHaveBeenCalledWith(["ob1"]);
  });

  it("never enqueues a group-restricted entry", async () => {
    await publish([note({ allMembers: false, groupIds: ["g1"] })]);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("skips Slack when no channel is configured", async () => {
    vi.stubEnv("RELEASE_NOTES_SLACK_CHANNEL_ID", "  ");
    await publish([note({})]);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("still publishes when the enqueue throws", async () => {
    vi.mocked(enqueueOutbound).mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(publish([note({})])).resolves.toEqual({ published: 1, skipped: 0 });
  });

  it("does not publish an entry with an empty summary", async () => {
    p.releaseNote.findMany.mockResolvedValueOnce([{ id: "n1", summary: " " }]);
    await expect(publishReleaseNotes(["n1"], "admin", request)).resolves.toEqual({
      published: 0,
      skipped: 1,
    });
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });
});

describe("publishReleaseNotes highlight notification", () => {
  it("does not notify for a non-highlight", async () => {
    await publish([note({})]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies every lab member for an all-members highlight", async () => {
    await publish([note({ highlight: true })]);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "release.published",
        message: expect.objectContaining({ link: "/release-notes/n1", title: "Room holds" }),
        recipients: [{ userId: "u1" }, { userId: "u2" }],
      }),
    );
  });

  it("notifies the deduplicated members of the groups for a restricted highlight", async () => {
    await publish([note({ highlight: true, allMembers: false, groupIds: ["g1", "g2"] })]);
    expect(vi.mocked(notify).mock.calls[0][0].recipients).toEqual([
      { userId: "u2" },
      { userId: "u3" },
      { userId: "u4" },
    ]);
  });
});

describe("releaseNoteSlackStatuses", () => {
  it("maps outbox rows by dedup key", async () => {
    p.outboundMessage.findMany.mockResolvedValue([{ dedupKey: "release-note:a", status: "Sent" }]);
    await expect(
      releaseNoteSlackStatuses([
        { id: "a", allMembers: true },
        { id: "b", allMembers: true },
        { id: "c", allMembers: false },
      ]),
    ).resolves.toEqual({ a: "posted", b: "app-only", c: "app-only" });
  });
});

describe("publishReleaseNotes video copy", () => {
  it("copies a PR capture to the published prefix before publishing", async () => {
    await publish([note({ videoKey: "release-notes/pr-12/demo.mp4" })]);
    expect(copyObject).toHaveBeenCalledWith("release-notes/pr-12/demo.mp4", "release-notes/published/n1.mp4");
    expect(p.releaseNote.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { videoKey: "release-notes/published/n1.mp4" },
    });
    expect(vi.mocked(copyObject).mock.invocationCallOrder[0]).toBeLessThan(
      p.releaseNote.updateMany.mock.invocationCallOrder[0],
    );
  });

  it("does not copy hand uploads", async () => {
    await publish([note({ videoKey: "release-notes/uploads/a.mp4" })]);
    expect(copyObject).not.toHaveBeenCalled();
    expect(p.releaseNote.update).not.toHaveBeenCalled();
  });

  it("leaves the entry a draft when the copy fails", async () => {
    vi.mocked(copyObject).mockRejectedValueOnce(new Error("s3 down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    p.releaseNote.findMany.mockResolvedValueOnce([
      { id: "n1", summary: "Hold rooms.", videoKey: "release-notes/pr-12/demo.mp4" },
    ]);
    await expect(publishReleaseNotes(["n1"], "admin", request)).resolves.toEqual({
      published: 0,
      skipped: 1,
    });
    expect(p.releaseNote.updateMany).not.toHaveBeenCalled();
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });
});

describe("markReleaseNotesSeen", () => {
  it("stamps the user and clears their cached unseen dot", async () => {
    await markReleaseNotesSeen("ada");
    expect(p.user.update).toHaveBeenCalledWith({
      where: { id: "ada" },
      data: { releaseNotesSeenAt: expect.any(Date) },
    });
    expect(invalidateLayoutCache).toHaveBeenCalledExactlyOnceWith("releaseNotes", ["ada"]);
  });

  it("clears nothing when the write fails", async () => {
    p.user.update.mockRejectedValueOnce(new Error("db down"));
    await expect(markReleaseNotesSeen("ada")).rejects.toThrow("db down");
    expect(invalidateLayoutCache).not.toHaveBeenCalled();
  });
});
