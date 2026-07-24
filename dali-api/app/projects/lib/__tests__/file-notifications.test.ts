import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/projects/lib/project-members.server", () => ({
  currentProjectParticipantIds: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { currentProjectParticipantIds } from "~/projects/lib/project-members.server";
import {
  notifyFileComment,
  notifyFileNewVersion,
} from "~/projects/lib/file-notifications.server";

const mockPrisma = prisma as unknown as {
  projectFile: { findUnique: ReturnType<typeof vi.fn> };
};
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;
const mockMembers = currentProjectParticipantIds as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every stakeholder is currently on the project.
  mockMembers.mockResolvedValue(new Set(["uploader", "mentor", "assignee"]));
});

// Audience: version uploaders + comment authors + linked-task assignees,
// with overlap (uploader is also an assignee here).
const FILE = {
  title: "Hero animation",
  projectId: "p1",
  versions: [{ uploadedById: "uploader" }, { uploadedById: "uploader" }],
  comments: [{ authorId: "mentor" }],
  taskLinks: [
    { task: { assignees: [{ userId: "assignee" }, { userId: "uploader" }] } },
  ],
};

function recipientIds(): string[] {
  const call = mockNotify.mock.calls[0][0];
  return call.recipients.map((r: { userId: string }) => r.userId).sort();
}

describe("notifyFileComment", () => {
  it("notifies the file's audience, excluding the comment author", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue(FILE);

    await notifyFileComment({ fileId: "f1", authorId: "mentor", body: "Tighten the easing" });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0];
    expect(call.eventType).toBe("file.comment");
    expect(call.message.title).toBe("New feedback on: Hero animation");
    expect(call.message.body).toBe("Tighten the easing");
    expect(call.message.link).toBe("/documents/file/f1");
    expect(recipientIds()).toEqual(["assignee", "uploader"]);
  });

  it("truncates long comment bodies to a preview", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue(FILE);

    await notifyFileComment({ fileId: "f1", authorId: "mentor", body: "x".repeat(300) });

    expect(mockNotify.mock.calls[0][0].message.body).toBe(`${"x".repeat(200)}…`);
  });

  it("excludes a stakeholder who has rolled off the project", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue(FILE);
    // "assignee" once worked the file but is no longer on the project.
    mockMembers.mockResolvedValue(new Set(["uploader", "mentor"]));

    await notifyFileComment({ fileId: "f1", authorId: "mentor", body: "note" });

    expect(currentProjectParticipantIds).toHaveBeenCalledWith("p1");
    expect(recipientIds()).toEqual(["uploader"]);
  });

  it("is a no-op when the author is the only stakeholder", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      title: "Solo",
      versions: [{ uploadedById: "uploader" }],
      comments: [],
      taskLinks: [],
    });

    await notifyFileComment({ fileId: "f1", authorId: "uploader", body: "note to self" });

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("is a no-op when the file is gone", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue(null);

    await notifyFileComment({ fileId: "gone", authorId: "mentor", body: "hi" });

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("notifyFileNewVersion", () => {
  it("labels the title with the version count and excludes the uploader", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue(FILE);

    await notifyFileNewVersion({ fileId: "f1", uploadedById: "uploader" });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const call = mockNotify.mock.calls[0][0];
    expect(call.eventType).toBe("file.new_version");
    expect(call.message.title).toBe("V2 uploaded: Hero animation");
    expect(recipientIds()).toEqual(["assignee", "mentor"]);
  });

  it("is a no-op with no audience beyond the uploader", async () => {
    mockPrisma.projectFile.findUnique.mockResolvedValue({
      title: "Solo",
      versions: [{ uploadedById: "uploader" }],
      comments: [],
      taskLinks: [],
    });

    await notifyFileNewVersion({ fileId: "f1", uploadedById: "uploader" });

    expect(mockNotify).not.toHaveBeenCalled();
  });
});
