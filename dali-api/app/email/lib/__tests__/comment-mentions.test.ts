import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveHandles = vi.fn();
const notifyMentions = vi.fn();
const findReadableAccount = vi.fn();

vi.mock("~/lib/mentions", () => ({
  extractHandlesFromText: (text: string) => [...text.matchAll(/@([a-z0-9_]+)/gi)].map((m) => m[1]!.toLowerCase()),
  resolveHandles: (...a: unknown[]) => resolveHandles(...a),
  notifyMentions: (...a: unknown[]) => notifyMentions(...a),
}));
vi.mock("~/email/lib/access.server", () => ({
  findReadableAccount: (...a: unknown[]) => findReadableAccount(...a),
  mailAccountLabel: (a: { address: string }) => a.address,
}));

import { notifyMailCommentMentions } from "../comment-mentions.server";

const account = { id: "acct1", address: "team@dali.dartmouth.edu" } as never;
const request = new Request("http://localhost/email");

describe("notifyMailCommentMentions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("notifies mentioned members who can read the inbox, linking to the thread", async () => {
    resolveHandles.mockResolvedValue(["author", "reader", "outsider"]);
    findReadableAccount.mockImplementation(async (userId: string) => (userId === "reader" ? account : null));

    await notifyMailCommentMentions({
      account,
      threadId: "thr1",
      authorId: "author",
      body: "@me @reader @outsider take a look",
      request,
    });

    expect(resolveHandles).toHaveBeenCalledWith(["me", "reader", "outsider"]);
    expect(notifyMentions).toHaveBeenCalledWith({
      recipientUserIds: ["reader"],
      actorId: "author",
      link: "/email?t=acct1~thr1",
      title: "You were mentioned in team@dali.dartmouth.edu",
      preview: "@me @reader @outsider take a look",
    });
  });
});
