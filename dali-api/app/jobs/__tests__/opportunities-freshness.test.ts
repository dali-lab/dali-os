import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/community/lib/job-link.server", () => ({ checkJobLinkAlive: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { checkJobLinkAlive } from "~/community/lib/job-link.server";
import { runOpportunitiesFreshness } from "~/jobs/opportunities-freshness.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;
const mockAlive = checkJobLinkAlive as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-11-17T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ctx = {
  now: NOW,
  lastSuccessAt: null,
  settings: { askAfterDays: 30, closeAfterDays: 7, chatAskDays: 30 },
};
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

let askCandidates: unknown[];
let linked: unknown[];
let claimCount: number;
let unansweredCount: number;
let chatCount: number;

function post(overrides: Record<string, unknown> = {}) {
  return { id: "p1", authorId: "u1", role: "Engineer", companyName: "Acme", ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  askCandidates = [];
  linked = [];
  claimCount = 1;
  unansweredCount = 0;
  chatCount = 0;
  db.opportunityPost = {
    findMany: vi.fn().mockImplementation(async (args: { where: { stillOpenAskedAt?: unknown } }) =>
      "stillOpenAskedAt" in args.where ? askCandidates : linked,
    ),
    updateMany: vi.fn().mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.kind === "ChatAsk") return { count: chatCount };
      if (args.where.stillOpenAskedAt && typeof args.where.stillOpenAskedAt === "object" && "lt" in (args.where.stillOpenAskedAt as object)) {
        return { count: unansweredCount };
      }
      if (args.where.stillOpenAskedAt === null) return { count: claimCount };
      return { count: 1 };
    }),
  } as never;
  mockNotify.mockResolvedValue({ inApp: 1, emailed: 0, slackDmed: 0 });
  mockAlive.mockResolvedValue("alive");
});

describe("runOpportunitiesFreshness", () => {
  it("selects open, unasked jobs with an author, posted or last confirmed open before askAfterDays", async () => {
    await runOpportunitiesFreshness(ctx);
    expect(db.opportunityPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: "Job",
          closedAt: null,
          stillOpenAskedAt: null,
          authorId: { not: null },
          OR: [{ confirmedOpenAt: null, createdAt: { lt: ago(30) } }, { confirmedOpenAt: { lt: ago(30) } }],
        },
      }),
    );
  });

  it("claims each candidate with a guarded updateMany and notifies once", async () => {
    askCandidates = [post()];
    const res = await runOpportunitiesFreshness(ctx);
    expect(db.opportunityPost.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", kind: "Job", closedAt: null, stillOpenAskedAt: null, OR: [{ confirmedOpenAt: null, createdAt: { lt: ago(30) } }, { confirmedOpenAt: { lt: ago(30) } }] },
      data: { stillOpenAskedAt: NOW },
    });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const arg = mockNotify.mock.calls[0][0];
    expect(arg.eventType).toBe("opportunities.still_open");
    expect(arg.recipients).toEqual([{ userId: "u1" }]);
    expect(arg.message.link).toBe("/community/opportunities");
    expect(arg.message.vars.itemDetail).toBe(
      "Engineer at Acme. Let people know if it's still open, or it closes in 7 days.",
    );
    expect(arg.message.dedupKey).toBe(`opportunities-still-open:p1:${NOW.toISOString()}`);
    expect(res.items).toBe(1);
    expect(res.note).toContain("asked 1");
  });

  it("does not notify when another run already claimed the row", async () => {
    askCandidates = [post()];
    claimCount = 0;
    const res = await runOpportunitiesFreshness(ctx);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(res.items).toBe(0);
  });

  it("skips posts with no author", async () => {
    askCandidates = [post({ authorId: null })];
    await runOpportunitiesFreshness(ctx);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(db.opportunityPost.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "p1" }) }),
    );
  });

  it("closes jobs whose ask went unanswered past closeAfterDays", async () => {
    unansweredCount = 3;
    const res = await runOpportunitiesFreshness(ctx);
    expect(db.opportunityPost.updateMany).toHaveBeenCalledWith({
      where: { kind: "Job", closedAt: null, stillOpenAskedAt: { lt: ago(7) } },
      data: { closedAt: NOW },
    });
    expect(res.items).toBe(3);
    expect(res.note).toContain("closed 3");
  });

  it("closes a job whose link is dead but not one that is unknown or alive", async () => {
    linked = [
      { id: "dead", jobUrl: "https://x.test/dead" },
      { id: "unknown", jobUrl: "https://x.test/unknown" },
      { id: "alive", jobUrl: "https://x.test/alive" },
    ];
    mockAlive.mockImplementation(async (url: string) =>
      url.endsWith("dead") ? "dead" : url.endsWith("unknown") ? "unknown" : "alive",
    );
    const res = await runOpportunitiesFreshness(ctx);
    const closes = db.opportunityPost.updateMany.mock.calls.filter(
      ([a]) => (a as { where: { id?: string } }).where.id && (a as { data: object }).data && "closedAt" in (a as { data: object }).data,
    );
    expect(closes).toHaveLength(1);
    expect(closes[0][0]).toEqual({ where: { id: "dead", closedAt: null }, data: { closedAt: NOW, linkCheckedAt: NOW } });
    for (const id of ["unknown", "alive"]) {
      expect(db.opportunityPost.updateMany).toHaveBeenCalledWith({
        where: { id, closedAt: null },
        data: { linkCheckedAt: NOW },
      });
    }
    expect(res.note).toContain("dead links 1");
  });

  it("checks at most 20 links per tick, least recently checked first", async () => {
    await runOpportunitiesFreshness(ctx);
    const call = db.opportunityPost.findMany.mock.calls.find(([a]) => (a as { where: { jobUrl?: unknown } }).where.jobUrl);
    expect(call![0]).toEqual(
      expect.objectContaining({
        where: { kind: "Job", closedAt: null, jobUrl: { not: null } },
        orderBy: { linkCheckedAt: { sort: "asc", nulls: "first" } },
        take: 20,
      }),
    );
  });

  it("closes chat asks older than chatAskDays", async () => {
    chatCount = 2;
    const res = await runOpportunitiesFreshness(ctx);
    expect(db.opportunityPost.updateMany).toHaveBeenCalledWith({
      where: { kind: "ChatAsk", closedAt: null, createdAt: { lt: ago(30) } },
      data: { closedAt: NOW },
    });
    expect(res.items).toBe(2);
    expect(res.note).toBe("asked 0, closed 0, dead links 0, chat asks 2");
  });

  it("makes no changes on a second run once everything is handled", async () => {
    askCandidates = [post()];
    await runOpportunitiesFreshness(ctx);
    mockNotify.mockClear();
    askCandidates = [];
    claimCount = 0;
    const res = await runOpportunitiesFreshness(ctx);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(res.items).toBe(0);
  });
});
