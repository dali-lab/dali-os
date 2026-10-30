import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  onboardingJourney: { findUnique: vi.fn(), findMany: vi.fn() },
  onboardingLabSubmission: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
  user: { findUnique: vi.fn(async () => ({ firstName: "Ana", lastName: "Torres" })) },
}));
const notify = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db.server", async () => {
  const { Prisma } = await import("~/lib/__mocks__/db.server");
  return { prisma: db, Prisma };
});
vi.mock("~/lib/notify.server", () => ({ notify }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async () => null) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { labApproved, listReviewIds, listReviews, loadReviewEntries, resetMyWork, reviewSubmission, saveMyWork, submitMyWork } from "../studio.server";
import type { JourneyViewer } from "../journeys.server";
import type { StudioLab } from "../studio-types";
import { mod } from "./fixtures";

const learner: JourneyViewer = { id: "learner", isCore: false, leadDomainIds: [] };
const mentor: JourneyViewer = { id: "mentor", isCore: false, leadDomainIds: [] };

const studio: StudioLab = {
  kind: "canvas",
  title: "Critique",
  brief: "",
  criteria: [
    { id: "a", label: "Two stickies", mode: "auto", rule: { kind: "item-count", itemType: "sticky", min: 2 } },
    { id: "s", label: "Self", mode: "self" },
    { id: "m", label: "Mentor", mode: "mentor" },
  ],
  canvas: { items: [], hotspots: [] },
};
const sticky = (id: string) => ({ id, type: "sticky", x: 0, y: 0 });

function journeyRow(lab: StudioLab | null = studio) {
  return {
    published: { title: "Design", description: "", modules: [mod("m1", [], lab ? { studio: lab } : {})] },
    domain: { code: "UIUX", displayName: "Design" },
    collaborators: [
      { userId: "mentor", role: "Editor" },
      { userId: "owner", role: "Owner" },
    ],
  };
}

function submission(status: string, work: object = { items: [] }, selfChecks: object = {}) {
  return { id: "sub1", status, work, selfChecks, mentorChecks: {}, mentorNote: null, submittedAt: null, reviewedAt: null, reviewer: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.onboardingJourney.findUnique.mockResolvedValue(journeyRow());
});

describe("saving work", () => {
  it("creates the row on the first save", async () => {
    db.onboardingLabSubmission.findUnique.mockResolvedValue(null);
    db.onboardingLabSubmission.upsert.mockResolvedValue(submission("InProgress", { items: [sticky("a")] }));
    const result = await saveMyWork(learner, "j1", "m1", { work: { items: [sticky("a") as never] } });
    expect(result).toMatchObject({ ok: true, submission: { status: "in-progress" } });
    expect(db.onboardingLabSubmission.upsert.mock.calls[0][0].where).toEqual({
      journeyId_moduleId_userId: { journeyId: "j1", moduleId: "m1", userId: "learner" },
    });
  });

  it("is locked while submitted or approved, but open again after changes are requested", async () => {
    for (const status of ["Submitted", "Approved"]) {
      db.onboardingLabSubmission.findUnique.mockResolvedValue({ status });
      expect(await saveMyWork(learner, "j1", "m1", { selfChecks: { s: true } })).toMatchObject({ ok: false, status: 409 });
      expect(await resetMyWork(learner, "j1", "m1")).toMatchObject({ ok: false, status: 409 });
    }
    db.onboardingLabSubmission.findUnique.mockResolvedValue({ status: "ChangesRequested" });
    db.onboardingLabSubmission.upsert.mockResolvedValue(submission("ChangesRequested"));
    expect(await saveMyWork(learner, "j1", "m1", { selfChecks: { s: true } })).toMatchObject({ ok: true });
  });

  it("only saves to published modules with a studio lab", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(journeyRow(null));
    expect(await saveMyWork(learner, "j1", "m1", {})).toMatchObject({ ok: false, status: 404 });
  });
});

describe("submitting", () => {
  it("re-runs the checks on the server", async () => {
    db.onboardingLabSubmission.findUnique.mockResolvedValue(submission("InProgress", { items: [sticky("a")] }, { s: true }));
    expect(await submitMyWork(learner, "j1", "m1")).toMatchObject({ ok: false, status: 400 });
    expect(db.onboardingLabSubmission.update).not.toHaveBeenCalled();
  });

  it("submits ready work and tells the journey's mentors, not the learner", async () => {
    db.onboardingLabSubmission.findUnique.mockResolvedValue(submission("InProgress", { items: [sticky("a"), sticky("b")] }, { s: true }));
    expect(await submitMyWork(learner, "j1", "m1")).toEqual({ ok: true });
    expect(db.onboardingLabSubmission.update.mock.calls[0][0].data).toMatchObject({ status: "Submitted" });
    const sent = notify.mock.calls[0][0];
    expect(sent.eventType).toBe("journey.lab_submitted");
    expect(sent.recipients).toEqual([{ userId: "mentor" }, { userId: "owner" }]);
    expect(sent.message.link).toBe("/journeys/reviews?submission=sub1");
  });

  it("refuses labs without mentor review, and work already sent", async () => {
    db.onboardingJourney.findUnique.mockResolvedValue(journeyRow({ ...studio, criteria: studio.criteria.slice(0, 2) }));
    expect(await submitMyWork(learner, "j1", "m1")).toMatchObject({ ok: false, status: 400 });
    db.onboardingJourney.findUnique.mockResolvedValue(journeyRow());
    db.onboardingLabSubmission.findUnique.mockResolvedValue(submission("Submitted"));
    expect(await submitMyWork(learner, "j1", "m1")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("reviewing", () => {
  const pending = (userId = "learner") => ({
    status: "Submitted",
    userId,
    journeyId: "j1",
    moduleId: "m1",
    journey: { collaborators: journeyRow().collaborators },
  });

  it("only lets the journey's editors review, never their own work", async () => {
    db.onboardingLabSubmission.findUnique.mockResolvedValue(pending());
    const outsider: JourneyViewer = { id: "x", isCore: false, leadDomainIds: [] };
    expect(await reviewSubmission(outsider, "sub1", { mentorChecks: { m: true }, note: "", decision: "approved" })).toMatchObject({ status: 404 });
    db.onboardingLabSubmission.findUnique.mockResolvedValue(pending("mentor"));
    expect(await reviewSubmission(mentor, "sub1", { mentorChecks: { m: true }, note: "", decision: "approved" })).toMatchObject({ status: 404 });
  });

  it("approves only with every mentor item ticked, and asks for a note on changes", async () => {
    db.onboardingLabSubmission.findUnique.mockResolvedValue(pending());
    expect(await reviewSubmission(mentor, "sub1", { mentorChecks: {}, note: "", decision: "approved" })).toMatchObject({ status: 400 });
    expect(await reviewSubmission(mentor, "sub1", { mentorChecks: {}, note: " ", decision: "changes-requested" })).toMatchObject({ status: 400 });
  });

  it("records the review, keeps only real mentor items, and tells the learner", async () => {
    db.onboardingLabSubmission.findUnique.mockResolvedValue(pending());
    const result = await reviewSubmission(mentor, "sub1", { mentorChecks: { m: true, a: true }, note: " Nice ", decision: "approved" });
    expect(result).toEqual({ ok: true });
    expect(db.onboardingLabSubmission.update.mock.calls[0][0].data).toMatchObject({
      status: "Approved",
      mentorChecks: { m: true },
      mentorNote: "Nice",
      reviewerId: "mentor",
    });
    expect(notify.mock.calls[0][0]).toMatchObject({
      eventType: "journey.lab_reviewed",
      recipients: [{ userId: "learner" }],
      message: { copyKey: "journey.lab_approved", link: "/journeys/uiux/j1/m1?view=lab" },
    });
  });

  it("won't review work twice", async () => {
    db.onboardingLabSubmission.findUnique.mockResolvedValue({ ...pending(), status: "Approved" });
    expect(await reviewSubmission(mentor, "sub1", { mentorChecks: { m: true }, note: "", decision: "approved" })).toMatchObject({ status: 409 });
  });
});

describe("queue and approval", () => {
  it("lists work on journeys the viewer edits, excluding their own", async () => {
    db.onboardingLabSubmission.findMany.mockResolvedValue([]);
    await listReviews(mentor);
    expect(db.onboardingLabSubmission.findMany.mock.calls[0][0].where).toEqual({
      status: { not: "InProgress" },
      userId: { not: "mentor" },
      journey: { collaborators: { some: { userId: "mentor" } } },
    });
  });

  it("pushes the status filter into the query so it runs before the limit", async () => {
    db.onboardingLabSubmission.findMany.mockResolvedValue([]);
    db.onboardingJourney.findMany.mockResolvedValue([]);
    await listReviewIds(mentor, "waiting");
    expect(db.onboardingLabSubmission.findMany.mock.calls[0][0].where.status).toBe("Submitted");
    await listReviewIds(mentor, "reviewed");
    expect(db.onboardingLabSubmission.findMany.mock.calls[1][0].where.status).toEqual({ in: ["Approved", "ChangesRequested"] });
    expect(db.onboardingLabSubmission.findMany.mock.calls[1][0].take).toBeUndefined();
  });

  it("drops ids whose module left the published journey, keeping the rest in order", async () => {
    db.onboardingLabSubmission.findMany.mockResolvedValue([
      { id: "s1", moduleId: "m1", journeyId: "j1" },
      { id: "s2", moduleId: "gone", journeyId: "j1" },
      { id: "s3", moduleId: "m1", journeyId: "j2" },
    ]);
    db.onboardingJourney.findMany.mockResolvedValue([
      { id: "j1", published: { title: "J", description: "", modules: [mod("m1", [], { studio })] } },
      { id: "j2", published: null },
    ]);
    expect(await listReviewIds(mentor)).toEqual(["s1"]);
  });

  it("loads entries by id, scoped to what the viewer can review", async () => {
    db.onboardingLabSubmission.findMany.mockResolvedValue([]);
    expect(await loadReviewEntries(mentor, [])).toEqual([]);
    await loadReviewEntries(mentor, ["s1"]);
    expect(db.onboardingLabSubmission.findMany.mock.calls[0][0].where.AND).toEqual([
      {
        status: { not: "InProgress" },
        userId: { not: "mentor" },
        journey: { collaborators: { some: { userId: "mentor" } } },
      },
      { id: { in: ["s1"] } },
    ]);
  });

  it("treats labs without mentor review as approved", async () => {
    expect(await labApproved("learner", "j1", "m1", { ...studio, criteria: [] })).toBe(true);
    db.onboardingLabSubmission.findUnique.mockResolvedValue({ status: "Submitted" });
    expect(await labApproved("learner", "j1", "m1", studio)).toBe(false);
    db.onboardingLabSubmission.findUnique.mockResolvedValue({ status: "Approved" });
    expect(await labApproved("learner", "j1", "m1", studio)).toBe(true);
  });
});
