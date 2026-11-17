import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  opportunityPost: {
    create: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  },
  opportunityComment: { create: vi.fn(), deleteMany: vi.fn() },
  opportunityReaction: { deleteMany: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  opportunityResponse: { create: vi.fn() },
  user: { findMany: vi.fn(), findUnique: vi.fn() },
}));
const notify = vi.hoisted(() => vi.fn());
const outbound = vi.hoisted(() => ({
  enqueueOutbound: vi.fn(async () => ({ id: "out1", deduped: false })),
  drainNow: vi.fn(),
}));
const mentions = vi.hoisted(() => ({
  extractHandlesFromText: vi.fn(() => ["ada"]),
  resolveHandles: vi.fn(async () => ["id-ada"]),
  notifyMentions: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/notify.server", () => ({ notify }));
vi.mock("~/lib/outbound.server", () => outbound);
vi.mock("~/lib/mentions.server", () => mentions);
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => null) }));
vi.mock("~/lib/s3.server", () => ({ isS3Configured: () => false, getDownloadUrl: vi.fn() }));
vi.mock("~/lib/app-env", () => ({ getFrontendUrl: () => "https://os.example.edu", getAppEnv: () => "dev" }));
vi.mock("~/community/lib/opportunities-viewer.server", () => ({
  canPostJob: (v: { core: boolean; alumni: boolean }) => v.core || v.alumni,
}));

import { checkRateLimit } from "~/lib/rate-limit";
import { runOpportunityAction } from "../opportunities-actions.server";

const student = { userId: "stu", core: false, alumni: false };
const alum = { userId: "alum", core: false, alumni: true };
const core = { userId: "core", core: true, alumni: false };

function run(viewer: typeof student, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return runOpportunityAction(new Request("http://x/community/opportunities", { method: "POST" }), viewer, form);
}

const jobFields = { intent: "create", kind: "Job", companyName: "Acme", role: "Designer", body: "We are hiring" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockReturnValue(null);
  db.opportunityPost.create.mockResolvedValue({ id: "p1" });
  db.opportunityPost.findUnique.mockResolvedValue({ id: "p1" });
  db.opportunityPost.deleteMany.mockResolvedValue({ count: 1 });
  db.opportunityPost.updateMany.mockResolvedValue({ count: 1 });
  db.opportunityReaction.deleteMany.mockResolvedValue({ count: 0 });
  db.opportunityReaction.findMany.mockResolvedValue([]);
  db.opportunityResponse.create.mockResolvedValue({ id: "r1" });
  db.user.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "Lovelace" });
});

describe("create a job", () => {
  it("refuses students", async () => {
    expect(await run(student, jobFields)).toEqual({ ok: false, status: 403 });
    expect(db.opportunityPost.create).not.toHaveBeenCalled();
  });

  it("lets alumni and Core post, writing every field", async () => {
    const result = await run(alum, {
      ...jobFields,
      location: "Remote",
      jobType: "Full-time",
      willRefer: "true",
      jobUrl: "https://jobs.example.com/1",
      logoKey: "uploads/opportunity-logos/a.png",
      companyDomain: "Acme.com",
      blockColor: "#aabbcc",
    });
    expect(result).toEqual({ ok: true });
    expect(db.opportunityPost.create).toHaveBeenCalledWith({
      data: {
        kind: "Job",
        authorId: "alum",
        body: "We are hiring",
        companyName: "Acme",
        role: "Designer",
        location: "Remote",
        jobType: "Full-time",
        jobUrl: "https://jobs.example.com/1",
        willRefer: true,
        logoKey: "uploads/opportunity-logos/a.png",
        companyDomain: "acme.com",
        blockColor: "#aabbcc",
      },
    });
    expect(await run(core, jobFields)).toEqual({ ok: true });
  });

  it("drops an invalid block color and domain instead of storing them", async () => {
    await run(alum, { ...jobFields, blockColor: "red", companyDomain: "not a domain" });
    const data = db.opportunityPost.create.mock.calls[0][0].data;
    expect(data.blockColor).toBeNull();
    expect(data.companyDomain).toBeNull();
    expect(data.willRefer).toBe(false);
  });

  it.each([
    ["missing company", { companyName: "" }],
    ["missing role", { role: "" }],
    ["missing message", { body: " " }],
    ["long role", { role: "x".repeat(201) }],
    ["long message", { body: "x".repeat(2001) }],
    ["non-http link", { jobUrl: "javascript:alert(1)" }],
    ["logo outside uploads", { logoKey: "private/secret.png" }],
    ["logo path traversal", { logoKey: "uploads/../secret.png" }],
  ])("rejects %s", async (_name, over) => {
    expect(await run(alum, { ...jobFields, ...over })).toEqual({ ok: false, status: 400 });
    expect(db.opportunityPost.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown kind, including DALI updates", async () => {
    expect(await run(core, { ...jobFields, kind: "DaliUpdate" })).toEqual({ ok: false, status: 400 });
  });

  it("is rate limited", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(new Response("", { status: 429 }));
    expect(await run(alum, jobFields)).toEqual({ ok: false, status: 429 });
  });
});

describe("create a chat ask", () => {
  const ask = { intent: "create", kind: "ChatAsk", topic: "Product design", body: "Hello" };

  it("lets a student ask and stores the topic", async () => {
    expect(await run(student, ask)).toEqual({ ok: true });
    expect(db.opportunityPost.create).toHaveBeenCalledWith({
      data: { kind: "ChatAsk", authorId: "stu", body: "Hello", topic: "Product design" },
      select: { id: true },
    });
  });

  it.each([
    ["no topic", { topic: "" }],
    ["long topic", { topic: "x".repeat(81) }],
    ["no message", { body: "" }],
  ])("rejects %s", async (_n, over) => {
    expect(await run(student, { ...ask, ...over })).toEqual({ ok: false, status: 400 });
  });

  it("notifies only people who match, never the asker", async () => {
    db.user.findMany.mockResolvedValue([
      { id: "m1", askMeAbout: ["product design "], openToCoffeeChats: true, openToResumeReviews: false, openToPortfolioReviews: false },
      { id: "m2", askMeAbout: ["Product design"], openToCoffeeChats: false, openToResumeReviews: false, openToPortfolioReviews: false },
      { id: "m3", askMeAbout: ["Robotics"], openToCoffeeChats: true, openToResumeReviews: false, openToPortfolioReviews: false },
    ]);
    await run(student, ask);
    expect(db.user.findMany.mock.calls[0][0].where.id).toEqual({ not: "stu" });
    expect(db.user.findMany.mock.calls[0][0].take).toBeGreaterThan(0);
    expect(notify).toHaveBeenCalledTimes(1);
    const args = notify.mock.calls[0][0];
    expect(args.eventType).toBe("opportunities.chat_ask_match");
    expect(args.recipients).toEqual([{ userId: "m1" }]);
    expect(args.message.vars.personName).toBe("Ada Lovelace");
  });

  it("matches review asks on the review switches", async () => {
    db.user.findMany.mockResolvedValue([
      { id: "r1", askMeAbout: [], openToCoffeeChats: false, openToResumeReviews: true, openToPortfolioReviews: false },
    ]);
    await run(student, { ...ask, topic: "Resume review" });
    expect(notify.mock.calls[0][0].recipients).toEqual([{ userId: "r1" }]);
  });

  it("sends nothing when nobody matches", async () => {
    await run(student, ask);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("delete and close", () => {
  it("scopes a member's delete to their own posts", async () => {
    await run(student, { intent: "delete", postId: "p1" });
    expect(db.opportunityPost.deleteMany).toHaveBeenCalledWith({ where: { id: "p1", authorId: "stu" } });
  });

  it("lets Core delete any post or comment", async () => {
    await run(core, { intent: "delete", postId: "p1" });
    expect(db.opportunityPost.deleteMany).toHaveBeenCalledWith({ where: { id: "p1" } });
    await run(core, { intent: "delete-comment", commentId: "c1" });
    expect(db.opportunityComment.deleteMany).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("scopes comment delete to the author for members", async () => {
    await run(student, { intent: "delete-comment", commentId: "c1" });
    expect(db.opportunityComment.deleteMany).toHaveBeenCalledWith({ where: { id: "c1", authorId: "stu" } });
  });

  it("closes only the author's own open job or ask, even for Core", async () => {
    await run(core, { intent: "close", postId: "p1" });
    const args = db.opportunityPost.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: "p1", authorId: "core", closedAt: null, kind: { in: ["Job", "ChatAsk"] } });
    expect(args.data.closedAt).toBeInstanceOf(Date);
  });

  it("keep-open clears the ask and records the confirmation", async () => {
    await run(alum, { intent: "keep-open", postId: "p1" });
    const args = db.opportunityPost.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: "p1", authorId: "alum", kind: "Job", stillOpenAskedAt: { not: null } });
    expect(args.data).toEqual({ stillOpenAskedAt: null, confirmedOpenAt: expect.any(Date) });
  });
});

describe("react and comment", () => {
  it("adds a reaction with the opportunity tables", async () => {
    expect(await run(student, { intent: "react", postId: "p1", emoji: "🔥" })).toEqual({ ok: true });
    expect(db.opportunityReaction.upsert).toHaveBeenCalled();
  });

  it("404s a reaction on a deleted post", async () => {
    db.opportunityPost.findUnique.mockResolvedValue(null);
    expect(await run(student, { intent: "react", postId: "p1", emoji: "🔥" })).toEqual({ ok: false, status: 404 });
  });

  it("comments and notifies mentions", async () => {
    await run(student, { intent: "comment", postId: "p1", body: "hi @ada" });
    expect(db.opportunityComment.create).toHaveBeenCalledWith({ data: { postId: "p1", authorId: "stu", body: "hi @ada" } });
    expect(mentions.notifyMentions).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ["id-ada"], actorId: "stu", link: "/community/opportunities" }),
    );
  });

  it("rejects empty and over-long comments", async () => {
    expect(await run(student, { intent: "comment", postId: "p1", body: " " })).toEqual({ ok: false, status: 400 });
    expect(await run(student, { intent: "comment", postId: "p1", body: "x".repeat(1001) })).toEqual({ ok: false, status: 400 });
  });
});

describe("interested", () => {
  const job = { kind: "Job", authorId: "alum", closedAt: null, role: "Designer", companyName: "Acme" };

  beforeEach(() => db.opportunityPost.findUnique.mockResolvedValue(job));

  it("records the response and notifies the author with a profile link", async () => {
    expect(await run(student, { intent: "interested", postId: "p1", note: " I love design " })).toEqual({ ok: true });
    expect(db.opportunityResponse.create).toHaveBeenCalledWith({
      data: { postId: "p1", userId: "stu", kind: "Interested", note: "I love design" },
      select: { id: true },
    });
    const args = notify.mock.calls[0][0];
    expect(args.eventType).toBe("opportunities.interest");
    expect(args.recipients).toEqual([{ userId: "alum" }]);
    expect(args.message.link).toBe("/members/stu");
    expect(args.message.vars.itemDetail).toContain("Designer at Acme");
    expect(args.message.vars.itemDetail).toContain("I love design");
  });

  it("does nothing the second time", async () => {
    db.opportunityResponse.create.mockRejectedValue({ code: "P2002" });
    expect(await run(student, { intent: "interested", postId: "p1" })).toEqual({ ok: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it("rethrows other database errors", async () => {
    db.opportunityResponse.create.mockRejectedValue(new Error("boom"));
    await expect(run(student, { intent: "interested", postId: "p1" })).rejects.toThrow("boom");
  });

  it("refuses your own job, a closed job, a chat ask, a DALI post and a long note", async () => {
    expect(await run(alum, { intent: "interested", postId: "p1" })).toEqual({ ok: false, status: 403 });
    db.opportunityPost.findUnique.mockResolvedValue({ ...job, closedAt: new Date() });
    expect(await run(student, { intent: "interested", postId: "p1" })).toEqual({ ok: false, status: 404 });
    db.opportunityPost.findUnique.mockResolvedValue({ ...job, kind: "ChatAsk" });
    expect(await run(student, { intent: "interested", postId: "p1" })).toEqual({ ok: false, status: 404 });
    db.opportunityPost.findUnique.mockResolvedValue({ ...job, authorId: null });
    expect(await run(student, { intent: "interested", postId: "p1" })).toEqual({ ok: false, status: 404 });
    db.opportunityPost.findUnique.mockResolvedValue(job);
    expect(await run(student, { intent: "interested", postId: "p1", note: "x".repeat(501) })).toEqual({ ok: false, status: 400 });
    expect(db.opportunityResponse.create).not.toHaveBeenCalled();
  });
});

describe("offer-chat", () => {
  const ask = { kind: "ChatAsk", authorId: "stu", closedAt: null, topic: "Product design" };

  beforeEach(() => {
    db.opportunityPost.findUnique.mockResolvedValue(ask);
    db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "alum"
        ? { firstName: "Grace", lastName: "Hopper", daliEmail: "grace@example.edu" }
        : { firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" },
    );
  });

  it("notifies the asker and queues one intro email to both, keyed without addresses", async () => {
    expect(await run(alum, { intent: "offer-chat", postId: "p1" })).toEqual({ ok: true });
    expect(db.opportunityResponse.create).toHaveBeenCalledWith({
      data: { postId: "p1", userId: "alum", kind: "ChatOffer", note: null },
      select: { id: true },
    });
    const n = notify.mock.calls[0][0];
    expect(n.eventType).toBe("opportunities.chat_offered");
    expect(n.recipients).toEqual([{ userId: "stu" }]);
    expect(n.message.vars.personName).toBe("Grace Hopper");
    expect(n.message.vars.itemDetail).toContain("reply to it");
    expect(n.message.vars.itemDetail).not.toContain("@");

    expect(outbound.enqueueOutbound).toHaveBeenCalledTimes(1);
    const mail = (outbound.enqueueOutbound.mock.calls as unknown as [Record<string, string>][])[0][0];
    expect(mail.channel).toBe("email");
    expect(mail.dedupKey).toBe("opportunities.chat_intro:r1");
    expect(mail.dedupKey).not.toContain("@");
    expect(mail.target).toContain("ada@example.edu");
    expect(mail.target).toContain("grace@example.edu");
    expect(outbound.drainNow).toHaveBeenCalledWith(["out1"]);
  });

  it("does nothing the second time", async () => {
    db.opportunityResponse.create.mockRejectedValue({ code: "P2002" });
    await run(alum, { intent: "offer-chat", postId: "p1" });
    expect(notify).not.toHaveBeenCalled();
    expect(outbound.enqueueOutbound).not.toHaveBeenCalled();
  });

  it("skips the email when someone has no address, but still notifies", async () => {
    db.user.findUnique.mockResolvedValue({ firstName: "Ada", lastName: "Lovelace" });
    await run(alum, { intent: "offer-chat", postId: "p1" });
    expect(notify).toHaveBeenCalled();
    expect(outbound.enqueueOutbound).not.toHaveBeenCalled();
  });

  it("refuses your own ask, a closed ask and a job post", async () => {
    expect(await run(student, { intent: "offer-chat", postId: "p1" })).toEqual({ ok: false, status: 403 });
    db.opportunityPost.findUnique.mockResolvedValue({ ...ask, closedAt: new Date() });
    expect(await run(alum, { intent: "offer-chat", postId: "p1" })).toEqual({ ok: false, status: 404 });
    db.opportunityPost.findUnique.mockResolvedValue({ ...ask, kind: "Job" });
    expect(await run(alum, { intent: "offer-chat", postId: "p1" })).toEqual({ ok: false, status: 404 });
  });
});

it("rejects an unknown intent", async () => {
  expect(await run(core, { intent: "nope" })).toEqual({ ok: false, status: 400 });
});
