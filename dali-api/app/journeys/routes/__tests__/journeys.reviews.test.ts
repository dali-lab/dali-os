import { beforeEach, describe, expect, it, vi } from "vitest";

const studio = vi.hoisted(() => ({
  countReviews: vi.fn(),
  listReviewedPage: vi.fn(),
  listWaitingReviews: vi.fn(),
  loadReviewEntry: vi.fn(),
  reviewSubmission: vi.fn(),
}));
const viewer = { id: "mentor", isCore: false, leadDomainIds: [] };

vi.mock("~/journeys/lib/studio.server", () => studio);
vi.mock("~/journeys/lib/journeys.server", () => ({ requireJourneyViewer: vi.fn(async () => viewer) }));

import { loader } from "../journeys.reviews";
import { loader as moreLoader } from "../journeys.reviews.more";

const entry = (id: string, status = "approved") => ({ submission: { id, status } });
const call = (query = "") => loader({ request: new Request(`http://os.test/journeys/reviews${query}`) } as never);

beforeEach(() => {
  vi.resetAllMocks();
  studio.listWaitingReviews.mockResolvedValue([entry("w1", "submitted")]);
  studio.listReviewedPage.mockResolvedValue({ items: [entry("r1")], nextCursor: "c1" });
  studio.countReviews.mockResolvedValue({ waiting: 1, reviewed: 80 });
  studio.loadReviewEntry.mockResolvedValue(null);
});

describe("journeys reviews loader", () => {
  it("returns true counts alongside the loaded rows", async () => {
    const out = await call();
    expect(out.counts).toEqual({ waiting: 1, reviewed: 80 });
    expect(out.reviewed.map((e: { submission: { id: string } }) => e.submission.id)).toEqual(["r1"]);
    expect(out.nextCursor).toBe("c1");
    expect(studio.loadReviewEntry).not.toHaveBeenCalled();
  });

  it("fetches a deep-linked reviewed row that is past the first page", async () => {
    studio.loadReviewEntry.mockResolvedValue(entry("old"));
    const out = await call("?submission=old");
    expect(studio.loadReviewEntry).toHaveBeenCalledWith(viewer, "old");
    expect(out.reviewed.map((e: { submission: { id: string } }) => e.submission.id)).toEqual(["r1", "old"]);
  });

  it("does not refetch a deep-linked row that is already loaded", async () => {
    await call("?submission=r1");
    await call("?submission=w1");
    expect(studio.loadReviewEntry).not.toHaveBeenCalled();
  });

  it("leaves out a deep link the viewer cannot see", async () => {
    const out = await call("?submission=hidden");
    expect(out.reviewed).toHaveLength(1);
  });
});

describe("journeys reviews more loader", () => {
  it("pages reviewed work for the viewer from the cursor", async () => {
    const res = (await moreLoader({ request: new Request("http://os.test/journeys/reviews/more?cursor=c1") } as never)) as Response;
    expect(studio.listReviewedPage).toHaveBeenCalledWith(viewer, "c1");
    expect(await res.json()).toEqual({ items: [entry("r1")], nextCursor: "c1" });
  });
});
