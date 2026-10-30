import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  onboardingJourney: { findUnique: vi.fn() },
  onboardingLabSubmission: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
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

import { countReviews, labApproved, listReviewedPage, listWaitingReviews, loadReviewEntry, REVIEWED_PAGE_SIZE, resetMyWork, reviewSubmission, saveMyWork, submitMyWork } from "../studio.server";
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
  const scope = { userId: { not: "mentor" }, journey: { collaborators: { some: { userId: "mentor" } } } };
  const row = (id: string, status: string, updatedAt: Date) => ({
    ...submission(status),
    id,
    updatedAt,
    moduleId: "m1",
    journeyId: "j1",
    user: { id: "learner", firstName: "Ada", lastName: "Lovelace", photoUrl: null },
    journey: { published: journeyRow().published, domain: { code: "UIUX", displayName: "Design" } },
  });

  it("loads every waiting submission with no cap, excluding the viewer's own", async () => {
    db.onboardingLabSubmission.findMany.mockResolvedValue([]);
    await listWaitingReviews(mentor);
    const args = db.onboardingLabSubmission.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: "Submitted", ...scope });
    expect(args.take).toBeUndefined();
  });

  it("scopes Core viewers to every journey", async () => {
    db.onboardingLabSubmission.findMany.mockResolvedValue([]);
    await listWaitingReviews({ id: "core", isCore: true, leadDomainIds: [] });
    expect(db.onboardingLabSubmission.findMany.mock.calls[0][0].where.journey).toEqual({});
  });

  it("pages reviewed work by updatedAt and id, with a cursor from the last row returned", async () => {
    const base = new Date("2026-10-01T00:00:00Z");
    const rows = Array.from({ length: REVIEWED_PAGE_SIZE + 1 }, (_, i) =>
      row(`r${i}`, "Approved", new Date(base.getTime() - i * 1000)),
    );
    db.onboardingLabSubmission.findMany.mockResolvedValue(rows);
    const page = await listReviewedPage(mentor, null);
    const args = db.onboardingLabSubmission.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ in: ["Approved", "ChangesRequested"] });
    expect(args.orderBy).toEqual([{ updatedAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(REVIEWED_PAGE_SIZE + 1);
    expect(page.items).toHaveLength(REVIEWED_PAGE_SIZE);
    expect(page.nextCursor).toBe(`${rows[REVIEWED_PAGE_SIZE - 1].updatedAt.toISOString()}|r${REVIEWED_PAGE_SIZE - 1}`);
  });

  it("has no cursor on the last reviewed page, and resumes after a cursor", async () => {
    db.onboardingLabSubmission.findMany.mockResolvedValue([row("r1", "ChangesRequested", new Date("2026-09-01T00:00:00Z"))]);
    const page = await listReviewedPage(mentor, "2026-10-01T00:00:00.000Z|r0");
    expect(page.nextCursor).toBeNull();
    expect(db.onboardingLabSubmission.findMany.mock.calls[0][0].where.OR).toEqual([
      { updatedAt: { lt: new Date("2026-10-01T00:00:00.000Z") } },
      { updatedAt: new Date("2026-10-01T00:00:00.000Z"), id: { lt: "r0" } },
    ]);
  });

  it("fetches one submission by id inside the viewer's scope, any state but in-progress", async () => {
    db.onboardingLabSubmission.findFirst.mockResolvedValue(row("old", "Approved", new Date()));
    const entry = await loadReviewEntry(mentor, "old");
    expect(entry?.submission.id).toBe("old");
    expect(db.onboardingLabSubmission.findFirst.mock.calls[0][0].where).toEqual({
      id: "old",
      status: { not: "InProgress" },
      ...scope,
    });
  });

  it("returns null for a submission outside the viewer's scope", async () => {
    db.onboardingLabSubmission.findFirst.mockResolvedValue(null);
    expect(await loadReviewEntry(mentor, "nope")).toBeNull();
  });

  it("counts waiting and reviewed work from the database, not from loaded rows", async () => {
    db.onboardingLabSubmission.count.mockResolvedValueOnce(412).mockResolvedValueOnce(97);
    expect(await countReviews(mentor)).toEqual({ waiting: 412, reviewed: 97 });
    const wheres = db.onboardingLabSubmission.count.mock.calls.map((c) => c[0].where.status);
    expect(wheres).toEqual(["Submitted", { in: ["Approved", "ChangesRequested"] }]);
  });

  it("treats labs without mentor review as approved", async () => {
    expect(await labApproved("learner", "j1", "m1", { ...studio, criteria: [] })).toBe(true);
    db.onboardingLabSubmission.findUnique.mockResolvedValue({ status: "Submitted" });
    expect(await labApproved("learner", "j1", "m1", studio)).toBe(false);
    db.onboardingLabSubmission.findUnique.mockResolvedValue({ status: "Approved" });
    expect(await labApproved("learner", "j1", "m1", studio)).toBe(true);
  });
});
