import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  opportunityPost: { findMany: vi.fn(), groupBy: vi.fn() },
  user: { findUnique: vi.fn() },
  customEmoji: { findMany: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/s3.server", () => ({ isS3Configured: () => false, getDownloadUrl: vi.fn() }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (u: string | null) => (u ? `signed:${u}` : null)) }));
vi.mock("~/partners/lib/referral-status.server", () => ({ loadMyReferrals: vi.fn(async () => [{ id: "ref1", partnerName: "Acme", partnerOrgName: null, tier: "Cold", status: "Sent", projectId: null, createdAt: new Date() }]) }));

import { encodeCursor } from "~/lib/pagination";
import {
  OPPORTUNITY_PAGE_SIZE,
  loadOpportunitiesPage,
  loadOpportunityCounts,
  loadOpportunityPage,
  loadOpportunityPostsByIds,
  parseShow,
} from "../opportunities-feed.server";

const viewer = { userId: "me", core: false, alumni: false };
const profile = { askMeAbout: ["Product design"], openToCoffeeChats: true, openToResumeReviews: false, openToPortfolioReviews: false };
const none = { askMeAbout: [], openToCoffeeChats: false, openToResumeReviews: false, openToPortfolioReviews: false };

function post(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    kind: "ChatAsk",
    body: `body ${id}`,
    topic: "Product design",
    jobUrl: null,
    companyName: null,
    companyDomain: null,
    logoKey: null,
    blockColor: null,
    role: null,
    location: null,
    jobType: null,
    willRefer: false,
    imageKey: null,
    stillOpenAskedAt: null,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    author: { id: "ada", firstName: "Ada", lastName: "Lovelace", photoUrl: "ada.png", classYear: 2019 },
    responses: [],
    reactions: [],
    comments: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.opportunityPost.findMany.mockResolvedValue([]);
});

describe("parseShow", () => {
  it("accepts jobs and chats, defaulting everything else to all", () => {
    expect(parseShow("jobs")).toBe("jobs");
    expect(parseShow("chats")).toBe("chats");
    expect(parseShow("x")).toBe("all");
    expect(parseShow(null)).toBe("all");
  });
});

describe("loadOpportunityPage", () => {
  it("reads open posts newest first, one past the page", async () => {
    await loadOpportunityPage(null, viewer, { show: "all", profile: none });
    const args = db.opportunityPost.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ closedAt: null });
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(OPPORTUNITY_PAGE_SIZE + 1);
  });

  it("filters by the Show param", async () => {
    await loadOpportunityPage(null, viewer, { show: "jobs", profile: none });
    expect(db.opportunityPost.findMany.mock.calls[0][0].where).toEqual({ closedAt: null, kind: "Job" });
    await loadOpportunityPage(null, viewer, { show: "chats", profile: none });
    expect(db.opportunityPost.findMany.mock.calls[1][0].where).toEqual({ closedAt: null, kind: "ChatAsk" });
  });

  it("returns a cursor only when another page exists", async () => {
    db.opportunityPost.findMany.mockResolvedValue(Array.from({ length: OPPORTUNITY_PAGE_SIZE + 1 }, (_, i) => post(`p${i}`)));
    const page = await loadOpportunityPage(null, viewer, { show: "all", profile: none });
    expect(page.items).toHaveLength(OPPORTUNITY_PAGE_SIZE);
    expect(page.nextCursor).toBe(encodeCursor({ at: "2026-03-01T00:00:00.000Z", id: `p${OPPORTUNITY_PAGE_SIZE - 1}` }));
  });

  it("pins matching asks on page one and leaves them out of the feed", async () => {
    db.opportunityPost.findMany
      .mockResolvedValueOnce([post("match"), post("other", { topic: "Robotics" })])
      .mockResolvedValueOnce([post("plain")]);
    const page = await loadOpportunityPage(null, viewer, { show: "all", profile });
    const pinQuery = db.opportunityPost.findMany.mock.calls[0][0];
    expect(pinQuery.where.NOT).toEqual({ authorId: "me" });
    expect(page.pinned.map((p) => p.id)).toEqual(["match"]);
    expect(page.pinned[0].matchReason).toBe("askMeAbout");
    expect(db.opportunityPost.findMany.mock.calls[1][0].where.id).toEqual({ notIn: ["match"] });
  });

  it("caps pins at five", async () => {
    db.opportunityPost.findMany.mockResolvedValueOnce(Array.from({ length: 8 }, (_, i) => post(`m${i}`))).mockResolvedValueOnce([]);
    const page = await loadOpportunityPage(null, viewer, { show: "all", profile });
    expect(page.pinned).toHaveLength(5);
  });

  it("does not pin on later pages, under Jobs, or without matching settings", async () => {
    const cursor = encodeCursor({ at: "2026-03-01T00:00:00.000Z", id: "p1" });
    await loadOpportunityPage(cursor, viewer, { show: "all", profile });
    expect(db.opportunityPost.findMany).toHaveBeenCalledTimes(1);
    db.opportunityPost.findMany.mockClear();
    await loadOpportunityPage(null, viewer, { show: "jobs", profile });
    expect(db.opportunityPost.findMany).toHaveBeenCalledTimes(1);
    db.opportunityPost.findMany.mockClear();
    await loadOpportunityPage(null, viewer, { show: "all", profile: none });
    expect(db.opportunityPost.findMany).toHaveBeenCalledTimes(1);
  });

  it("shapes a job post with logo url, response state and permissions", async () => {
    db.opportunityPost.findMany.mockResolvedValue([
      post("j1", {
        kind: "Job",
        topic: null,
        role: "Designer",
        companyName: "Acme",
        logoKey: "uploads/logos/a b.png",
        willRefer: true,
        responses: [{ userId: "me", kind: "Interested" }],
        stillOpenAskedAt: new Date(),
      }),
    ]);
    const { items } = await loadOpportunityPage(null, viewer, { show: "all", profile: none });
    const p = items[0];
    expect(p.job?.logoUrl).toBe("/api/upload/raw?key=uploads%2Flogos%2Fa%20b.png");
    expect(p.viewerResponded).toBe(true);
    expect(p.responseCount).toBe(1);
    expect(p.author).toMatchObject({ name: "Ada Lovelace", photoUrl: "signed:ada.png", classYear: 2019 });
    expect(p.canDelete).toBe(false);
    expect(p.askStillOpen).toBe(false);
  });

  it("gives the author delete, close and the still-open prompt, and Core delete", async () => {
    db.opportunityPost.findMany.mockResolvedValue([post("j1", { kind: "Job", stillOpenAskedAt: new Date(), author: { id: "me", firstName: "Me", lastName: "", photoUrl: null, classYear: null } })]);
    const mine = (await loadOpportunityPage(null, viewer, { show: "all", profile: none })).items[0];
    expect(mine).toMatchObject({ isOwn: true, canDelete: true, canClose: true, askStillOpen: true, matchReason: null });
    db.opportunityPost.findMany.mockResolvedValue([post("p2")]);
    const asCore = (await loadOpportunityPage(null, { ...viewer, core: true }, { show: "all", profile: none })).items[0];
    expect(asCore).toMatchObject({ canDelete: true, canClose: false });
  });

  it("shows a null author as DALI Lab", async () => {
    db.opportunityPost.findMany.mockResolvedValue([post("d1", { kind: "DaliUpdate", author: null, imageKey: "uploads/x.png" })]);
    const p = (await loadOpportunityPage(null, viewer, { show: "all", profile: none })).items[0];
    expect(p.author.name).toBe("DALI Lab");
    expect(p.imageUrl).toBe("/api/upload/raw?key=uploads%2Fx.png");
    expect(p.canClose).toBe(false);
  });

  it("gives no match reason on your own ask", async () => {
    db.opportunityPost.findMany.mockResolvedValue([post("mine", { author: { id: "me", firstName: "Me", lastName: "", photoUrl: null, classYear: null } })]);
    const p = (await loadOpportunityPage(null, viewer, { show: "chats", profile })).items[0];
    expect(p.matchReason).toBeNull();
  });
});

describe("loadOpportunityPostsByIds", () => {
  it("returns nothing for no ids and reads only open posts otherwise", async () => {
    expect(await loadOpportunityPostsByIds([], viewer, none)).toEqual([]);
    await loadOpportunityPostsByIds(["a", "a", "b"], viewer, none);
    expect(db.opportunityPost.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["a", "b"] }, closedAt: null });
  });
});

describe("counts and page", () => {
  it("counts open posts by kind", async () => {
    db.opportunityPost.groupBy.mockResolvedValue([
      { kind: "Job", _count: { _all: 3 } },
      { kind: "ChatAsk", _count: { _all: 2 } },
      { kind: "DaliUpdate", _count: { _all: 1 } },
    ]);
    expect(await loadOpportunityCounts()).toEqual({ all: 6, jobs: 3, chats: 2 });
  });

  it("bundles the viewer, counts and referrals", async () => {
    db.user.findUnique.mockResolvedValue({ id: "me", firstName: "Me", lastName: "Too", photoUrl: null, classYear: null, ...none });
    db.opportunityPost.groupBy.mockResolvedValue([]);
    const page = await loadOpportunitiesPage(null, viewer, "all");
    expect(page.me.name).toBe("Me Too");
    expect(page.counts).toEqual({ all: 0, jobs: 0, chats: 0 });
    expect(page.referrals).toEqual([{ id: "ref1", partnerName: "Acme", partnerOrgName: null, status: "Sent", projectId: null }]);
  });
});
