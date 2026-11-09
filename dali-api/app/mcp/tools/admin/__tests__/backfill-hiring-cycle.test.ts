import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/forms/lib/form-page.server", () => ({ createForm: vi.fn() }));
vi.mock("~/lib/drive-receivers.server", () => ({
  resolveFilingFolder: vi.fn().mockResolvedValue({ folderId: "folder-forms" }),
  singletonSlot: vi.fn().mockReturnValue({}),
}));
vi.mock("~/lib/drive-roots.server", () => ({ ensureRoot: vi.fn().mockResolvedValue("folder-hiring") }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/outbound.server", () => ({ enqueueOutbound: vi.fn() }));
vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { createForm } from "~/forms/lib/form-page.server";
import { notify } from "~/lib/notify.server";
import { enqueueOutbound } from "~/lib/outbound.server";
import { sendEmail } from "~/lib/gmail";
import {
  runBackfillHiringCycle,
  BACKFILL_HIRING_CYCLE_TOOL,
} from "~/mcp/tools/admin/backfill-hiring-cycle";
import type { McpCtx } from "~/mcp/registry";

type Fns = Record<string, ReturnType<typeof vi.fn>>;
const db = prisma as unknown as Record<string, Fns> & { $transaction: ReturnType<typeof vi.fn> };

const ctx: McpCtx = {
  user: { id: "admin-1", daliEmail: null, dartmouthEmail: null, netId: null, firstName: "A", lastName: "B" },
  scopes: ["mcp:admin"],
  request: new Request("https://example.com"),
};

const CYCLE_AT = "2020-01-05T00:00:00.000Z";
const CLOSE_AT = "2020-02-10T00:00:00.000Z";
const APP_AT = "2020-01-20T00:00:00.000Z";
const SUBMIT_AT = "2020-01-25T00:00:00.000Z";
const INVITE_AT = "2020-02-01T00:00:00.000Z";
const DECIDED_AT = "2020-02-15T00:00:00.000Z";
const iso = (s: string) => new Date(s);

const ids = (...v: string[]) => v.map((id) => ({ id }));

function input(overrides: Record<string, unknown> = {}) {
  return {
    cycle: { name: "Winter 2020", createdAt: CYCLE_AT, closeDate: CLOSE_AT },
    domains: [{ domainId: "d1" }, { domainId: "d2" }],
    applications: [
      {
        applicant: { netId: "f001", firstName: "Ada", lastName: "Lovelace" },
        createdAt: APP_AT,
        domainApplications: [{ domainId: "d1", submittedAt: SUBMIT_AT }],
      },
    ],
    ...overrides,
  };
}

function fn(value?: unknown) {
  return vi.fn().mockResolvedValue(value);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  const model = (extra: Fns = {}): Fns => ({
    findMany: fn([]),
    findFirst: fn(null),
    findUnique: fn(null),
    create: fn({ id: "new-id" }),
    update: fn({}),
    updateMany: fn({ count: 0 }),
    upsert: fn({ id: "upserted-id" }),
    count: fn(0),
    ...extra,
  });
  db.user = model({
    findMany: fn(ids("rev-1", "rev-2")),
    create: fn({ id: "user-new" }),
  });
  db.domain = model({
    findMany: fn([
      { id: "d1", displayName: "Design" },
      { id: "d2", displayName: "Dev" },
    ]),
  });
  db.term = model({ findMany: fn(ids("t1", "t2")) });
  db.applicationCycle = model({ create: fn({ id: "cycle-new" }) });
  db.domainApplicationCycle = model();
  db.cycleDomainForm = model();
  db.form = model();
  db.rubric = model({ create: fn({ id: "rubric-1" }) });
  db.rubricVersion = model({ create: fn({ id: "rv-1" }) });
  db.application = model({ create: fn({ id: "app-1" }) });
  db.applicationStatusUpdate = model();
  db.domainApplication = model({ create: fn({ id: "da-1" }) });
  db.cycleReviewer = model({ upsert: fn({ id: "cr-1" }) });
  db.applicationReview = model();
  db.decision = model();
  db.interview = model({ create: fn({ id: "int-1" }) });
  db.cycleInterviewer = model({ upsert: fn({ id: "ci-1" }) });
  db.interviewAssignment = model();
  vi.mocked(createForm).mockResolvedValue({ id: "form-1" } as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db.$transaction = vi.fn(async (f: any) => f(db));
});

const writes = () =>
  Object.entries(db)
    .filter(([k]) => k !== "$transaction")
    .flatMap(([, m]) => ["create", "update", "updateMany", "upsert"].map((a) => (m as Fns)[a]))
    .filter(Boolean);
const nothingWritten = () => {
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(createForm).not.toHaveBeenCalled();
  for (const w of writes()) expect(w).not.toHaveBeenCalled();
};

describe("backfill_hiring_cycle", () => {
  it("requires the mcp:admin scope", () => {
    expect(BACKFILL_HIRING_CYCLE_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("is Forbidden for a non-admin and writes nothing", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expect(runBackfillHiringCycle(ctx, input())).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
    nothingWritten();
  });

  it("lists every unknown id in one InvalidError and writes nothing", async () => {
    db.user.findMany.mockResolvedValue(ids("rev-1"));
    db.domain.findMany.mockResolvedValue([{ id: "d1", displayName: "Design" }]);
    db.term.findMany.mockResolvedValue([]);
    const err = await runBackfillHiringCycle(
      ctx,
      input({
        cycle: { name: "Winter 2020", createdAt: CYCLE_AT, termId: "t-ghost" },
        domains: [{ domainId: "d1" }, { domainId: "d-ghost" }],
        applications: [
          {
            applicant: { userId: "u-ghost" },
            createdAt: APP_AT,
            domainApplications: [
              {
                domainId: "d1",
                submittedAt: SUBMIT_AT,
                reviews: [{ reviewerUserId: "rev-ghost", submittedAt: SUBMIT_AT, scores: { a: 1 } }],
              },
            ],
          },
        ],
      }),
    ).catch((e) => e);
    expect(err).toMatchObject({ name: "McpInvalidError", status: 400 });
    expect(err.message).toBe(
      "Unknown userId(s): u-ghost, rev-ghost. Unknown domainId(s): d-ghost. Unknown termId(s): t-ghost.",
    );
    nothingWritten();
  });

  it("rejects an unknown cycleId", async () => {
    const err = await runBackfillHiringCycle(ctx, input({ cycleId: "c-ghost" })).catch((e) => e);
    expect(err.message).toBe("Unknown cycleId(s): c-ghost.");
    nothingWritten();
  });

  it("rejects an existing cycle name without cycleId", async () => {
    db.applicationCycle.findFirst.mockResolvedValue({ id: "c-old" });
    const err = await runBackfillHiringCycle(ctx, input()).catch((e) => e);
    expect(err).toMatchObject({ name: "McpInvalidError" });
    expect(err.message).toContain("Pass cycleId");
    nothingWritten();
  });

  it("rejects an application domain missing from the cycle's domains", async () => {
    const err = await runBackfillHiringCycle(ctx, input({ domains: [{ domainId: "d2" }] })).catch((e) => e);
    expect(err.message).toBe("Domain(s) used by applications but not in domains: d1.");
    nothingWritten();
  });

  describe("schema", () => {
    it("rejects Waitlisted outcomes", async () => {
      const bad = input({
        applications: [
          {
            applicant: { netId: "f001" },
            createdAt: APP_AT,
            domainApplications: [
              { domainId: "d1", submittedAt: SUBMIT_AT, outcome: { type: "Waitlisted", decidedAt: DECIDED_AT } },
            ],
          },
        ],
      });
      await expect(runBackfillHiringCycle(ctx, bad)).rejects.toMatchObject({ name: "McpInvalidError" });
      nothingWritten();
    });

    it("rejects more than 200 applications", async () => {
      const one = input().applications[0];
      const err = await runBackfillHiringCycle(ctx, input({ applications: Array(201).fill(one) })).catch((e) => e);
      expect(err).toMatchObject({ name: "McpInvalidError" });
      nothingWritten();
    });

    it("rejects an invite that is not before the decision", async () => {
      const bad = input({
        applications: [
          {
            applicant: { netId: "f001" },
            createdAt: APP_AT,
            domainApplications: [
              {
                domainId: "d1",
                submittedAt: SUBMIT_AT,
                outcome: { type: "Rejected", decidedAt: INVITE_AT, invitedToInterviewAt: DECIDED_AT },
              },
            ],
          },
        ],
      });
      await expect(runBackfillHiringCycle(ctx, bad)).rejects.toMatchObject({ name: "McpInvalidError" });
    });

    it("rejects a timestamp without an offset", async () => {
      await expect(
        runBackfillHiringCycle(ctx, input({ cycle: { name: "W", createdAt: "2020-01-05" } })),
      ).rejects.toMatchObject({ name: "McpInvalidError" });
    });
  });

  describe("cycle rows", () => {
    it("stamps the cycle and a single Completed status with the input dates", async () => {
      const out = await runBackfillHiringCycle(ctx, input());
      const data = db.applicationCycle.create.mock.calls[0][0].data;
      expect(data.createdAt).toEqual(iso(CYCLE_AT));
      expect(data.closeDate).toEqual(iso(CLOSE_AT));
      expect(data.statusUpdates.create).toEqual({
        newStatus: "Completed",
        userId: "admin-1",
        createdAt: iso(CLOSE_AT),
      });
      expect(data).toMatchObject({ applicants: "Students", hasChallenges: true, hasInterviews: true });
      expect(out).toMatchObject({ ok: true, cycleId: "cycle-new", cycleCreated: true, cycleAppended: false });
    });

    it("falls back to createdAt for the status row when there is no closeDate", async () => {
      await runBackfillHiringCycle(ctx, input({ cycle: { name: "W", createdAt: CYCLE_AT } }));
      const data = db.applicationCycle.create.mock.calls[0][0].data;
      expect(data.statusUpdates.create.createdAt).toEqual(iso(CYCLE_AT));
    });

    it("lets the input override hasChallenges and hasInterviews", async () => {
      await runBackfillHiringCycle(
        ctx,
        input({ cycle: { name: "W", createdAt: CYCLE_AT, hasChallenges: false, hasInterviews: false } }),
      );
      expect(db.applicationCycle.create.mock.calls[0][0].data).toMatchObject({
        hasChallenges: false,
        hasInterviews: false,
      });
    });

    it("appends to an existing cycle without creating or re-statusing it", async () => {
      db.applicationCycle.findUnique.mockResolvedValue({
        id: "c-old",
        name: "Winter 2020",
        createdAt: iso(CYCLE_AT),
        applicants: "Students",
        applicationFormId: null,
        domains: [],
        domainChallengeForms: [],
      });
      const out = await runBackfillHiringCycle(ctx, input({ cycleId: "c-old" }));
      expect(db.applicationCycle.create).not.toHaveBeenCalled();
      expect(db.applicationCycle.findFirst).not.toHaveBeenCalled();
      expect(db.application.create.mock.calls[0][0].data.applicationCycleId).toBe("c-old");
      expect(out).toMatchObject({ cycleId: "c-old", cycleCreated: false, cycleAppended: true });
    });
  });

  describe("forms and rubrics", () => {
    const questions = [{ key: "q1", type: "text", required: true, data: { label: "Why?" } }];

    it("files the application form in the hiring forms folder and binds it", async () => {
      await runBackfillHiringCycle(ctx, input({ applicationForm: { name: "Winter app", questions } }));
      const arg = vi.mocked(createForm).mock.calls[0][0] as Record<string, any>;
      expect(arg).toMatchObject({ name: "Winter app", folderPageId: "folder-forms", createdById: "admin-1" });
      expect(arg.createdAt).toEqual(iso(CYCLE_AT));
      expect(arg.versions.create).toMatchObject({ versionNumber: 1, createdAt: iso(CYCLE_AT) });
      expect(db.applicationCycle.create.mock.calls[0][0].data.applicationFormId).toBe("form-1");
    });

    it("does not create an application form when the cycle already has one", async () => {
      db.applicationCycle.findUnique.mockResolvedValue({
        id: "c-old",
        name: "Winter 2020",
        createdAt: iso(CYCLE_AT),
        applicants: "Students",
        applicationFormId: "form-old",
        domains: [],
        domainChallengeForms: [],
      });
      await runBackfillHiringCycle(ctx, input({ cycleId: "c-old", applicationForm: { name: "x", questions } }));
      expect(createForm).not.toHaveBeenCalled();
    });

    it("pins the latest application form version on new applications", async () => {
      db.form.findUnique.mockResolvedValue({ versions: [{ id: "fv-9" }] });
      await runBackfillHiringCycle(ctx, input({ applicationForm: { name: "Winter app", questions } }));
      expect(db.application.create.mock.calls[0][0].data.applicationFormVersionId).toBe("fv-9");
    });

    it("creates a rubric and version, binds it to the domain, and uses it on reviews", async () => {
      const criteria = [{ key: "c1", label: "Craft", maxScore: 5 }];
      await runBackfillHiringCycle(
        ctx,
        input({
          domains: [{ domainId: "d1", rubric: { name: "Design rubric", criteria } }, { domainId: "d2" }],
          applications: [
            {
              applicant: { netId: "f001" },
              createdAt: APP_AT,
              domainApplications: [
                {
                  domainId: "d1",
                  submittedAt: SUBMIT_AT,
                  reviews: [{ reviewerUserId: "rev-1", submittedAt: SUBMIT_AT, scores: { c1: 4 } }],
                },
              ],
            },
          ],
        }),
      );
      expect(db.rubric.create.mock.calls[0][0].data).toMatchObject({
        name: "Design rubric",
        folderPageId: "folder-hiring",
        createdAt: iso(CYCLE_AT),
      });
      expect(db.rubricVersion.create.mock.calls[0][0].data).toMatchObject({
        rubricId: "rubric-1",
        versionNumber: 1,
        criteria,
        createdById: "admin-1",
      });
      const dacCall = db.domainApplicationCycle.upsert.mock.calls.find((c) => c[0].create.domainId === "d1")!;
      expect(dacCall[0].create).toMatchObject({ isReady: true, rubricVersionId: "rv-1" });
      expect(db.applicationReview.upsert.mock.calls[0][0].create.rubricVersionId).toBe("rv-1");
    });

    it("does not create a second rubric when the domain already has one", async () => {
      db.applicationCycle.findUnique.mockResolvedValue({
        id: "c-old",
        name: "Winter 2020",
        createdAt: iso(CYCLE_AT),
        applicants: "Students",
        applicationFormId: null,
        domains: [{ domainId: "d1", rubricVersionId: "rv-old" }],
        domainChallengeForms: [],
      });
      await runBackfillHiringCycle(
        ctx,
        input({
          cycleId: "c-old",
          domains: [{ domainId: "d1", rubric: { name: "R", criteria: [] } }],
        }),
      );
      expect(db.rubric.create).not.toHaveBeenCalled();
    });

    it("binds a challenge form through CycleDomainForm and pins its version on domain applications", async () => {
      db.cycleDomainForm.findMany.mockResolvedValue([{ domainId: "d1", form: { versions: [{ id: "fv-ch" }] } }]);
      await runBackfillHiringCycle(
        ctx,
        input({ domains: [{ domainId: "d1", challengeForm: { name: "Design challenge", questions } }] }),
      );
      expect(vi.mocked(createForm).mock.calls[0][0]).toMatchObject({ name: "Design challenge" });
      expect(db.cycleDomainForm.create.mock.calls[0][0].data).toMatchObject({
        applicationCycleId: "cycle-new",
        domainId: "d1",
        formId: "form-1",
      });
      expect(db.domainApplication.create.mock.calls[0][0].data.challengeFormVersionId).toBe("fv-ch");
    });
  });

  describe("applicant resolution", () => {
    it("matches by netId before email", async () => {
      db.user.findFirst.mockResolvedValueOnce({ id: "u-net", firstName: "Ada", lastName: "L", netId: "f001" });
      const out = await runBackfillHiringCycle(
        ctx,
        input({
          applications: [
            {
              applicant: { netId: "f001", email: "ada@dartmouth.edu", firstName: "Ada", lastName: "L" },
              createdAt: APP_AT,
              domainApplications: [{ domainId: "d1", submittedAt: SUBMIT_AT }],
            },
          ],
        }),
      );
      expect(db.user.findFirst.mock.calls[0][0].where).toEqual({ netId: "f001" });
      expect(db.application.create.mock.calls[0][0].data.userId).toBe("u-net");
      expect(db.user.create).not.toHaveBeenCalled();
      expect(out).toMatchObject({ usersMatched: 1, usersCreated: 0 });
    });

    it("falls back to every email column", async () => {
      db.user.findFirst
        .mockResolvedValueOnce({ id: "u-mail", firstName: "A", lastName: "L", dartmouthEmail: "ada@dartmouth.edu" })
        .mockResolvedValue(null);
      await runBackfillHiringCycle(
        ctx,
        input({
          applications: [
            {
              applicant: { email: "Ada@Dartmouth.edu" },
              createdAt: APP_AT,
              domainApplications: [{ domainId: "d1", submittedAt: SUBMIT_AT }],
            },
          ],
        }),
      );
      expect(db.user.findFirst.mock.calls[0][0].where.OR).toEqual([
        { daliEmail: "ada@dartmouth.edu" },
        { dartmouthEmail: "ada@dartmouth.edu" },
        { personalEmail: "ada@dartmouth.edu" },
      ]);
      expect(db.application.create.mock.calls[0][0].data.userId).toBe("u-mail");
    });

    it("matches an explicit userId first", async () => {
      db.user.findMany.mockResolvedValue(ids("u-id"));
      db.user.findUnique.mockResolvedValueOnce({ id: "u-id", firstName: "A", lastName: "L" });
      await runBackfillHiringCycle(
        ctx,
        input({
          applications: [
            {
              applicant: { userId: "u-id", netId: "f001" },
              createdAt: APP_AT,
              domainApplications: [{ domainId: "d1", submittedAt: SUBMIT_AT }],
            },
          ],
        }),
      );
      expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u-id" } }));
      expect(db.application.create.mock.calls[0][0].data.userId).toBe("u-id");
    });

    it("creates a plain User with no membership and only the given fields when nothing matches", async () => {
      const out = await runBackfillHiringCycle(
        ctx,
        input({
          applications: [
            {
              applicant: { netId: "F001", email: "ada@gmail.com", firstName: "Ada" },
              createdAt: APP_AT,
              domainApplications: [{ domainId: "d1", submittedAt: SUBMIT_AT }],
            },
          ],
        }),
      );
      const data = db.user.create.mock.calls[0][0].data;
      expect(data).toEqual({
        firstName: "Ada",
        lastName: "",
        personalEmail: "ada@gmail.com",
        netId: "f001",
        createdAt: iso(APP_AT),
      });
      expect(data).not.toHaveProperty("daliMember");
      expect(db.application.create.mock.calls[0][0].data.userId).toBe("user-new");
      expect(out).toMatchObject({ usersCreated: 1, usersMatched: 0 });
    });

    it("never overwrites existing user fields, only fills blanks", async () => {
      db.user.findFirst
        .mockResolvedValueOnce({
          id: "u-net",
          firstName: "Existing",
          lastName: "",
          netId: "f001",
          dartmouthEmail: null,
        })
        .mockResolvedValue(null);
      await runBackfillHiringCycle(
        ctx,
        input({
          applications: [
            {
              applicant: { netId: "f001", email: "ada@dartmouth.edu", firstName: "Other", lastName: "Lovelace" },
              createdAt: APP_AT,
              domainApplications: [{ domainId: "d1", submittedAt: SUBMIT_AT }],
            },
          ],
        }),
      );
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: "u-net" },
        data: { lastName: "Lovelace", dartmouthEmail: "ada@dartmouth.edu" },
      });
    });

    it("does not fill an identity another account already holds", async () => {
      db.user.findFirst
        .mockResolvedValueOnce({ id: "u-net", firstName: "A", lastName: "L", netId: "f001" })
        .mockResolvedValueOnce({ id: "someone-else" });
      await runBackfillHiringCycle(
        ctx,
        input({
          applications: [
            {
              applicant: { netId: "f001", email: "ada@dartmouth.edu" },
              createdAt: APP_AT,
              domainApplications: [{ domainId: "d1", submittedAt: SUBMIT_AT }],
            },
          ],
        }),
      );
      expect(db.user.update).not.toHaveBeenCalled();
    });
  });

  describe("applications and domain applications", () => {
    it("stamps the application, Submitted status and domain application with historical times", async () => {
      const out = await runBackfillHiringCycle(
        ctx,
        input({
          applications: [
            {
              applicant: { netId: "f001" },
              createdAt: APP_AT,
              answers: { q1: "hi" },
              domainApplications: [
                { domainId: "d1", submittedAt: "2020-01-26T00:00:00.000Z", answers: { q2: "x" } },
                { domainId: "d2", submittedAt: SUBMIT_AT },
              ],
            },
          ],
        }),
      );
      expect(db.application.create.mock.calls[0][0].data).toMatchObject({
        createdAt: iso(APP_AT),
        answers: { q1: "hi" },
      });
      expect(db.applicationStatusUpdate.create).toHaveBeenCalledTimes(1);
      expect(db.applicationStatusUpdate.create.mock.calls[0][0].data).toMatchObject({
        newStatus: "Submitted",
        createdAt: iso(SUBMIT_AT),
      });
      const das = db.domainApplication.create.mock.calls.map((c) => c[0].data);
      expect(das[0]).toMatchObject({
        submittedAt: iso("2020-01-26T00:00:00.000Z"),
        createdAt: iso("2020-01-26T00:00:00.000Z"),
        answers: { q2: "x" },
        selected: true,
      });
      expect(das[1].answers).toEqual({});
      expect(out).toMatchObject({ applicationsCreated: 1, domainApplicationsCreated: 2 });
    });

    it("writes a Withdrawn status after Submitted for withdrawn applications", async () => {
      await runBackfillHiringCycle(
        ctx,
        input({
          applications: [
            {
              applicant: { netId: "f001" },
              createdAt: APP_AT,
              domainApplications: [{ domainId: "d1", submittedAt: SUBMIT_AT, withdrawn: true }],
            },
          ],
        }),
      );
      const [submitted, withdrawn] = db.applicationStatusUpdate.create.mock.calls.map((c) => c[0].data);
      expect(submitted.newStatus).toBe("Submitted");
      expect(withdrawn.newStatus).toBe("Withdrawn");
      expect(withdrawn.createdAt.getTime()).toBeGreaterThan(submitted.createdAt.getTime());
    });

    it("does not duplicate an existing Submitted status or domain application on rerun", async () => {
      db.application.findUnique.mockResolvedValue({ id: "app-old", applicationFormVersionId: "fv-1" });
      db.applicationStatusUpdate.findFirst.mockResolvedValue({ id: "s-1" });
      db.domainApplication.findFirst.mockResolvedValue({ id: "da-old" });
      const out = await runBackfillHiringCycle(ctx, input());
      expect(db.application.create).not.toHaveBeenCalled();
      expect(db.applicationStatusUpdate.create).not.toHaveBeenCalled();
      expect(db.domainApplication.create).not.toHaveBeenCalled();
      expect(out).toMatchObject({ applicationsCreated: 0, applicationsUpdated: 1, domainApplicationsCreated: 0 });
    });
  });

  describe("reviews", () => {
    const withReview = (extra: Record<string, unknown> = {}) =>
      input({
        applications: [
          {
            applicant: { netId: "f001" },
            createdAt: APP_AT,
            domainApplications: [
              {
                domainId: "d1",
                submittedAt: SUBMIT_AT,
                reviews: [
                  {
                    reviewerUserId: "rev-1",
                    submittedAt: "2020-01-28T00:00:00.000Z",
                    scores: { c1: 3 },
                    feedback: "Solid",
                    ...extra,
                  },
                ],
              },
            ],
          },
        ],
      });

    it("upserts the reviewer and a submitted review authored by the reviewer", async () => {
      const out = await runBackfillHiringCycle(ctx, withReview({ overallRecommendation: "Hire" }));
      expect(db.cycleReviewer.upsert.mock.calls[0][0].where.userId_applicationCycleId_domainId).toEqual({
        userId: "rev-1",
        applicationCycleId: "cycle-new",
        domainId: "d1",
      });
      const review = db.applicationReview.upsert.mock.calls[0][0].create;
      expect(review).toMatchObject({
        cycleReviewerId: "cr-1",
        domainApplicationId: "da-1",
        scores: { c1: 3 },
        feedback: "Solid",
        rejectionRationale: "",
        overallRecommendation: "Hire",
        submittedAt: iso("2020-01-28T00:00:00.000Z"),
        submittedById: "rev-1",
        createdAt: iso("2020-01-28T00:00:00.000Z"),
      });
      expect(db.applicationReview.upsert.mock.calls[0][0].update).toEqual({});
      expect(out).toMatchObject({ reviewsUpserted: 1 });
    });
  });

  describe("decisions", () => {
    const withOutcome = (outcome: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      input({
        applications: [
          {
            applicant: { netId: "f001" },
            createdAt: APP_AT,
            domainApplications: [{ domainId: "d1", submittedAt: SUBMIT_AT, outcome, ...extra }],
          },
        ],
      });

    it("writes Released invite then outcome with strictly increasing historical times", async () => {
      const out = await runBackfillHiringCycle(
        ctx,
        withOutcome({ type: "Rejected", decidedAt: DECIDED_AT, invitedToInterviewAt: INVITE_AT, notes: "Not a fit" }),
      );
      const [invite, outcome] = db.decision.create.mock.calls.map((c) => c[0].data);
      expect(invite).toMatchObject({
        type: "InvitedToInterview",
        stage: "Released",
        madeById: "admin-1",
        createdAt: iso(INVITE_AT),
      });
      expect(outcome).toMatchObject({
        type: "Rejected",
        stage: "Released",
        madeById: "admin-1",
        notes: "Not a fit",
        createdAt: iso(DECIDED_AT),
      });
      expect(invite.createdAt.getTime()).toBeLessThan(outcome.createdAt.getTime());
      expect(out).toMatchObject({ decisionsWritten: 2 });
    });

    it("writes only the outcome when there was no invite", async () => {
      await runBackfillHiringCycle(ctx, withOutcome({ type: "Rejected", decidedAt: DECIDED_AT }));
      expect(db.decision.create).toHaveBeenCalledTimes(1);
      expect(db.decision.create.mock.calls[0][0].data.notes).toBeNull();
    });

    it("writes no decisions when the domain application already has some", async () => {
      db.decision.count.mockResolvedValue(1);
      const out = await runBackfillHiringCycle(
        ctx,
        withOutcome({ type: "Accepted", decidedAt: DECIDED_AT, invitedToInterviewAt: INVITE_AT }),
      );
      expect(db.decision.create).not.toHaveBeenCalled();
      expect(out).toMatchObject({ decisionsWritten: 0 });
    });

    it("writes no decisions without an outcome", async () => {
      await runBackfillHiringCycle(ctx, input());
      expect(db.decision.create).not.toHaveBeenCalled();
    });

    it("closes undecided sibling domain applications as AcceptedElsewhere at the decision time", async () => {
      await runBackfillHiringCycle(ctx, withOutcome({ type: "Accepted", decidedAt: DECIDED_AT }));
      expect(db.domainApplication.updateMany).toHaveBeenCalledWith({
        where: {
          applicationId: "app-1",
          id: { not: "da-1" },
          selected: true,
          closureReason: null,
          decisions: { none: { stage: "Released" } },
        },
        data: { closureReason: "AcceptedElsewhere", closedAt: iso(DECIDED_AT) },
      });
    });

    it("closes siblings only after every decision of the application is written", async () => {
      const order: string[] = [];
      db.decision.create.mockImplementation(async ({ data }: any) => {
        order.push(`decision:${data.type}`);
        return { id: "dec" };
      });
      db.domainApplication.updateMany.mockImplementation(async () => {
        order.push("close");
        return { count: 0 };
      });
      let n = 0;
      db.domainApplication.create.mockImplementation(async () => ({ id: `da-${++n}` }));
      await runBackfillHiringCycle(
        ctx,
        input({
          applications: [
            {
              applicant: { netId: "f001" },
              createdAt: APP_AT,
              domainApplications: [
                { domainId: "d1", submittedAt: SUBMIT_AT, outcome: { type: "Accepted", decidedAt: DECIDED_AT } },
                { domainId: "d2", submittedAt: SUBMIT_AT, outcome: { type: "Rejected", decidedAt: INVITE_AT } },
              ],
            },
          ],
        }),
      );
      expect(order).toEqual(["decision:Accepted", "decision:Rejected", "close"]);
    });

    it("does not close siblings for a Rejected outcome", async () => {
      await runBackfillHiringCycle(ctx, withOutcome({ type: "Rejected", decidedAt: DECIDED_AT }));
      expect(db.domainApplication.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("interviews", () => {
    const withInterview = (interview: Record<string, unknown>) =>
      input({
        applications: [
          {
            applicant: { netId: "f001" },
            createdAt: APP_AT,
            domainApplications: [{ domainId: "d1", submittedAt: SUBMIT_AT, interview }],
          },
        ],
      });
    const interview = {
      startTime: "2020-02-03T15:00:00.000Z",
      endTime: "2020-02-03T15:30:00.000Z",
      interviewerUserIds: ["rev-1", "rev-2"],
      notes: "Strong portfolio",
    };

    it("creates a Completed interview with no calendar, room or video fields", async () => {
      const out = await runBackfillHiringCycle(ctx, withInterview(interview));
      const data = db.interview.create.mock.calls[0][0].data;
      expect(data).toEqual({
        domainApplicationId: "da-1",
        applicationCycleId: "cycle-new",
        interviewRoundId: "interviews",
        startTime: iso(interview.startTime),
        endTime: iso(interview.endTime),
        status: "Completed",
        recommendationNotes: "Strong portfolio",
        createdAt: iso(interview.startTime),
      });
      expect(out).toMatchObject({ interviewsCreated: 1 });
    });

    it("assigns each interviewer in the domain for the round", async () => {
      await runBackfillHiringCycle(ctx, withInterview(interview));
      expect(db.cycleInterviewer.upsert).toHaveBeenCalledTimes(2);
      expect(db.cycleInterviewer.upsert.mock.calls[0][0].create).toMatchObject({
        userId: "rev-1",
        domainId: "d1",
        interviewRoundId: "interviews",
      });
      expect(db.interviewAssignment.create).toHaveBeenCalledTimes(2);
      expect(db.interviewAssignment.create.mock.calls[0][0].data).toMatchObject({
        interviewId: "int-1",
        cycleInterviewerId: "ci-1",
        role: "InDomain",
        status: "Active",
      });
    });

    it("skips a domain application that already has an interview", async () => {
      db.interview.count.mockResolvedValue(1);
      const out = await runBackfillHiringCycle(ctx, withInterview(interview));
      expect(db.interview.create).not.toHaveBeenCalled();
      expect(db.interviewAssignment.create).not.toHaveBeenCalled();
      expect(out).toMatchObject({ interviewsCreated: 0 });
    });
  });

  describe("transaction and side effects", () => {
    it("writes everything inside one transaction with a generous timeout", async () => {
      await runBackfillHiringCycle(ctx, input());
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$transaction.mock.calls[0][1]).toMatchObject({ timeout: 300_000, maxWait: 30_000 });
    });

    it("sends no notifications, outbound messages or email", async () => {
      await runBackfillHiringCycle(
        ctx,
        input({
          applications: [
            {
              applicant: { netId: "f001" },
              createdAt: APP_AT,
              domainApplications: [
                { domainId: "d1", submittedAt: SUBMIT_AT, outcome: { type: "Accepted", decidedAt: DECIDED_AT } },
              ],
            },
          ],
        }),
      );
      expect(notify).not.toHaveBeenCalled();
      expect(enqueueOutbound).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("creates no members and raises no eligibility", async () => {
      await runBackfillHiringCycle(ctx, input());
      expect(db.user.create.mock.calls[0][0].data).not.toHaveProperty("daliMember");
      for (const f of Object.values(db.domainEligibility ?? {})) expect(f).not.toHaveBeenCalled();
    });

    it("writes one audit event with the counts and returns them", async () => {
      const out = await runBackfillHiringCycle(ctx, input());
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "hiring.cycle.backfill",
          userId: "admin-1",
          targetId: "cycle-new",
          metadata: expect.objectContaining({ name: "Winter 2020", applicationsCreated: 1, usersCreated: 1 }),
        }),
      );
      expect(out).toEqual({
        ok: true,
        cycleId: "cycle-new",
        cycleCreated: true,
        cycleAppended: false,
        usersMatched: 0,
        usersCreated: 1,
        applicationsCreated: 1,
        applicationsUpdated: 0,
        domainApplicationsCreated: 1,
        reviewsUpserted: 0,
        decisionsWritten: 0,
        interviewsCreated: 0,
      });
    });
  });
});
