import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  feedbackPost: { findUnique: vi.fn(), create: vi.fn() },
  feedbackComment: { create: vi.fn() },
  feedbackReaction: { deleteMany: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  customEmoji: { count: vi.fn() },
}));
const mentions = vi.hoisted(() => ({
  extractHandlesFromText: vi.fn((text: string) =>
    [...text.matchAll(/@([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase()),
  ),
  resolveHandles: vi.fn(async (handles: string[]) => handles.map((h) => `id-${h}`)),
  notifyMentions: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/mentions.server", () => mentions);
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => null) }));
vi.mock("~/lib/s3.server", () => ({ isS3Configured: () => false, getDownloadUrl: vi.fn() }));
vi.mock("~/lib/feedback.server", () => ({
  requireFeedbackViewer: vi.fn(async () => ({ user: { sub: "me" }, core: false })),
}));
vi.mock("~/lib/feedback-feed.server", () => ({ loadFeedbackPage: vi.fn() }));

import { action } from "../feedback";

function run(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return action({
    request: new Request("http://x/feedback", { method: "POST", body: form }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.feedbackPost.findUnique.mockResolvedValue({ id: "p1" });
  db.feedbackReaction.deleteMany.mockResolvedValue({ count: 0 });
  db.feedbackReaction.findMany.mockResolvedValue([]);
});

describe("comment", () => {
  it("notifies the people it mentions, linking to the feed", async () => {
    await run({ intent: "comment", postId: "p1", body: "cc @ada and @grace" });
    expect(db.feedbackComment.create).toHaveBeenCalled();
    expect(mentions.notifyMentions).toHaveBeenCalledWith({
      recipientUserIds: ["id-ada", "id-grace"],
      actorId: "me",
      link: "/feedback",
      copyKey: "mention.comment",
      preview: "cc @ada and @grace",
    });
  });

  it("doesn't notify when the comment isn't saved", async () => {
    await run({ intent: "comment", postId: "p1", body: "  " });
    expect(mentions.notifyMentions).not.toHaveBeenCalled();
  });
});

describe("react", () => {
  it("takes back a reaction without validating it, so a deleted emoji can be removed", async () => {
    db.feedbackReaction.deleteMany.mockResolvedValue({ count: 1 });
    await run({ intent: "react", postId: "p1", emoji: ":gone:" });
    expect(db.customEmoji.count).not.toHaveBeenCalled();
    expect(db.feedbackReaction.upsert).not.toHaveBeenCalled();
  });

  it("adds any standard emoji", async () => {
    await run({ intent: "react", postId: "p1", emoji: "🦄" });
    expect(db.feedbackReaction.upsert).toHaveBeenCalled();
  });

  it("refuses a deleted custom emoji as a new reaction", async () => {
    db.customEmoji.count.mockResolvedValue(0);
    await run({ intent: "react", postId: "p1", emoji: ":gone:" });
    expect(db.feedbackReaction.upsert).not.toHaveBeenCalled();
  });

  it("refuses a new emoji at the cap", async () => {
    db.feedbackReaction.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ emoji: `:e${i}:` })),
    );
    await run({ intent: "react", postId: "p1", emoji: "🦄" });
    expect(db.feedbackReaction.upsert).not.toHaveBeenCalled();
  });
});

describe("create", () => {
  it("stores no page for a request written on the feed", async () => {
    await run({ intent: "create", body: "A request", pagePath: "" });
    expect(db.feedbackPost.create.mock.calls[0][0].data.pagePath).toBeNull();
  });
});
