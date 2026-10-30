import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JourneyContent } from "~/journeys/lib/types";

const state = vi.hoisted(() => ({ draft: null as unknown as JourneyContent }));
const server = vi.hoisted(() => ({
  resolveJourneyViewer: vi.fn(),
  editDraft: vi.fn(),
}));
const studioServer = vi.hoisted(() => ({ listWaitingReviews: vi.fn(), listReviewedPage: vi.fn(), loadReviewEntry: vi.fn(), reviewSubmission: vi.fn() }));

vi.mock("~/journeys/lib/journeys.server", () => server);
vi.mock("~/journeys/lib/studio.server", () => studioServer);
vi.mock("~/lib/db", () => ({ prisma: { onboardingJourney: { findUnique: vi.fn(async () => ({ domain: { code: "UIUX" } })) } } }));
vi.mock("~/collab/blocknote-server", () => ({
  markdownToBlocks: vi.fn(async (md: string) => [{ type: "heading", content: [{ type: "text", text: md, styles: {} }], children: [] }]),
  blocksToMarkdown: vi.fn(async () => "### Why\nBecause"),
}));

import { MANAGE_JOURNEY_REVIEWS, SET_JOURNEY_STUDIO_LAB } from "../manage-studio";
import { mod } from "~/journeys/lib/__tests__/fixtures";
import { createLab } from "~/journeys/lib/journey-edit";

const ctx = { user: { id: "me" }, scopes: ["mcp:write"], request: new Request("http://x") } as never;

beforeEach(() => {
  vi.clearAllMocks();
  state.draft = { title: "J", description: "", modules: [mod("a"), mod("b", [], { lab: createLab() })] };
  server.resolveJourneyViewer.mockResolvedValue({ id: "me", isCore: false, leadDomainIds: [] });
  server.editDraft.mockImplementation(async (_v, id, edit) => {
    state.draft = JSON.parse(JSON.stringify(await edit(state.draft)));
    return { ok: true, draft: { id, ...state.draft }, version: "v2" };
  });
});

describe("set_journey_studio_lab", () => {
  it("sets a whiteboard lab, filling in ids", async () => {
    await SET_JOURNEY_STUDIO_LAB.run(ctx, {
      journeyId: "j",
      moduleId: "a",
      lab: {
        kind: "canvas",
        title: "Critique",
        criteria: [{ label: "Pin 2 problems", mode: "auto", rule: { kind: "hotspots", min: 2 } }, { label: "Mentor", mode: "mentor" }],
        canvas: { items: [{ type: "sticky", x: 0, y: 0, text: "Start" }], hotspots: [{ label: "A", x: 0, y: 0, width: 10, height: 10 }, { label: "B", x: 20, y: 0, width: 10, height: 10 }] },
      },
    });
    const studio = state.draft.modules[0].studio!;
    expect(studio.criteria.map((c) => c.id.startsWith("crit-"))).toEqual([true, true]);
    expect(studio.canvas?.hotspots).toHaveLength(2);
    expect(studio.canvas?.items[0].id).toMatch(/^item-/);
  });

  it("turns a Markdown template into the document lab's starting document", async () => {
    await SET_JOURNEY_STUDIO_LAB.run(ctx, { journeyId: "j", moduleId: "a", lab: { kind: "document", title: "Ticket", criteria: [{ label: "x", mode: "self" }], documentTemplateMarkdown: "### Why" } });
    expect(JSON.stringify(state.draft.modules[0].studio?.document?.template)).toContain("### Why");
  });

  it("rejects bad rules and a module that already has a code lab", async () => {
    await expect(
      SET_JOURNEY_STUDIO_LAB.run(ctx, { journeyId: "j", moduleId: "a", lab: { kind: "canvas", title: "x", criteria: [{ label: "x", mode: "auto", rule: { kind: "nope" } }] } }),
    ).rejects.toThrow(/couldn't be read/);
    await expect(
      SET_JOURNEY_STUDIO_LAB.run(ctx, { journeyId: "j", moduleId: "b", lab: { kind: "canvas", title: "x", criteria: [] } }),
    ).rejects.toThrow(/code lab/);
  });

  it("removes the lab", async () => {
    await SET_JOURNEY_STUDIO_LAB.run(ctx, { journeyId: "j", moduleId: "a", lab: { kind: "canvas", title: "x", criteria: [] } });
    await SET_JOURNEY_STUDIO_LAB.run(ctx, { journeyId: "j", moduleId: "a", remove: true });
    expect(state.draft.modules[0].studio).toBeUndefined();
  });
});

describe("manage_journey_reviews", () => {
  const studio = {
    kind: "canvas" as const,
    title: "Critique",
    brief: "",
    criteria: [{ id: "m", label: "Mentor", mode: "mentor" as const }],
    canvas: { items: [], hotspots: [{ id: "h", label: "Title", x: 0, y: 0, width: 50, height: 50 }] },
  };
  const entry = (status: string) => ({
    submission: {
      id: `sub-${status}`,
      status,
      work: { items: [{ id: "p", type: "pin", x: 10, y: 10, text: "Contrast" }, { id: "s", type: "sticky", x: 0, y: 0, fromStarter: true }] },
      selfChecks: {},
      mentorChecks: {},
      mentorNote: null,
      reviewerName: null,
      submittedAt: null,
      reviewedAt: null,
    },
    studio,
    learner: { id: "l", name: "Theo", photoUrl: null },
    moduleTitle: "Critique",
    journeyTitle: "Design",
    labHref: "/x",
  });

  beforeEach(() => {
    studioServer.listWaitingReviews.mockResolvedValue([entry("submitted")]);
    studioServer.listReviewedPage.mockResolvedValue({ items: [entry("approved")], nextCursor: "2026-10-01T00:00:00.000Z|sub-approved" });
    studioServer.loadReviewEntry.mockImplementation(async (_v: unknown, id: string) => (id === "sub-submitted" ? entry("submitted") : null));
  });

  it("lists waiting work by default, and reviewed work on request", async () => {
    const waiting = (await MANAGE_JOURNEY_REVIEWS.run(ctx, { action: "list" })) as { submissions: { submissionId: string }[] };
    expect(waiting.submissions.map((s) => s.submissionId)).toEqual(["sub-submitted"]);
    const done = (await MANAGE_JOURNEY_REVIEWS.run(ctx, { action: "list", status: "reviewed" })) as {
      submissions: { submissionId: string }[];
      nextCursor: string | null;
    };
    expect(done.submissions.map((s) => s.submissionId)).toEqual(["sub-approved"]);
    expect(done.nextCursor).toBe("2026-10-01T00:00:00.000Z|sub-approved");
  });

  it("passes the cursor through when paging reviewed work", async () => {
    await MANAGE_JOURNEY_REVIEWS.run(ctx, { action: "list", status: "reviewed", cursor: "c1" });
    expect(studioServer.listReviewedPage).toHaveBeenCalledWith(expect.anything(), "c1");
  });

  it("reports an unknown submission as not found", async () => {
    await expect(MANAGE_JOURNEY_REVIEWS.run(ctx, { action: "get", submissionId: "missing" })).rejects.toThrow(/not found/i);
  });

  it("describes the learner's own board items and found problem areas", async () => {
    const out = (await MANAGE_JOURNEY_REVIEWS.run(ctx, { action: "get", submissionId: "sub-submitted" })) as Record<string, unknown>;
    expect(out.work).toEqual([{ type: "pin", color: undefined, text: "Contrast", x: 10, y: 10 }]);
    expect(out.hotspots).toEqual([{ label: "Title", found: true }]);
  });

  it("passes a review through to the server", async () => {
    studioServer.reviewSubmission.mockResolvedValue({ ok: true });
    await MANAGE_JOURNEY_REVIEWS.run(ctx, { action: "review", submissionId: "sub-submitted", decision: "approved", mentorChecks: { m: true } });
    expect(studioServer.reviewSubmission).toHaveBeenCalledWith(expect.anything(), "sub-submitted", { mentorChecks: { m: true }, note: "", decision: "approved" });
  });

  it("maps a refused review to an MCP error", async () => {
    studioServer.reviewSubmission.mockResolvedValue({ ok: false, status: 400, error: "Tick every review item to approve." });
    await expect(MANAGE_JOURNEY_REVIEWS.run(ctx, { action: "review", submissionId: "x", decision: "approved" })).rejects.toThrow(/Tick every/);
  });
});
