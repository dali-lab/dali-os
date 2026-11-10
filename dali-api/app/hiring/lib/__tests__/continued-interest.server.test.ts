import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/hiring/lib/presign", () => ({
  presignAnswers: vi.fn(async (_q: unknown, a: Record<string, string>) => ({ ...a, presigned: "yes" })),
}));

import { prisma, Prisma } from "~/lib/db.server";
import { presignAnswers } from "~/hiring/lib/presign";
import {
  listWaitlistedApplications,
  reuseWaitlistedApplication,
  stopUsingWaitlistedApplication,
  loadContinuedInterestView,
} from "~/hiring/lib/continued-interest.server";

const db = prisma as any;

const waitlistedRow = (id: string, at: string, over: Record<string, unknown> = {}) => ({
  id,
  domainId: "dom1",
  domain: { name: "Design" },
  application: { applicationCycle: { name: "26F" } },
  decisions: [{ createdAt: new Date(at) }],
  ...over,
});

let tx: any;

beforeEach(() => {
  vi.clearAllMocks();
  tx = {
    application: { upsert: vi.fn().mockResolvedValue({ id: "newapp" }), update: vi.fn() },
    domainApplication: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  db.$transaction = vi.fn(async (fn: (t: any) => unknown) => fn(tx));
  db.domainApplication = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
  db.formVersion = { findFirst: vi.fn().mockResolvedValue({ id: "fv-latest" }), findUnique: vi.fn() };
  db.cycleDomainForm = { findFirst: vi.fn() };
});

describe("listWaitlistedApplications", () => {
  it("only offers Released Waitlisted applications from other Students cycles in domains this cycle hires", async () => {
    await listWaitlistedApplications("u1", "c-now");

    expect(db.domainApplication.findMany.mock.calls[0][0].where).toEqual({
      application: {
        userId: "u1",
        applicationCycleId: { not: "c-now" },
        applicationCycle: { applicants: "Students" },
      },
      domain: { applicationCycles: { some: { applicationCycleId: "c-now" } } },
      decisions: { some: { stage: "Released", type: "Waitlisted" } },
    });
  });

  it("returns the newest waitlisting first with ISO timestamps", async () => {
    db.domainApplication.findMany.mockResolvedValue([
      waitlistedRow("old", "2025-05-01T00:00:00Z"),
      waitlistedRow("new", "2026-05-01T00:00:00Z", { domainId: "dom2", domain: { name: "Dev" } }),
    ]);

    expect(await listWaitlistedApplications("u1", "c-now")).toEqual([
      {
        domainApplicationId: "new",
        domainId: "dom2",
        domainName: "Dev",
        cycleName: "26F",
        waitlistedAt: "2026-05-01T00:00:00.000Z",
      },
      {
        domainApplicationId: "old",
        domainId: "dom1",
        domainName: "Design",
        cycleName: "26F",
        waitlistedAt: "2025-05-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("reuseWaitlistedApplication", () => {
  const cycle = { id: "c-now", continuedInterestFormId: "cif" };
  const reuse = (over: Record<string, unknown> = {}) =>
    reuseWaitlistedApplication({
      userId: "u1",
      cycle,
      waitlistedDomainApplicationId: "wl1",
      startTermId: "term1",
      ...over,
    } as any);

  beforeEach(() => {
    db.domainApplication.findMany.mockResolvedValue([waitlistedRow("wl1", "2026-05-01T00:00:00Z")]);
    db.domainApplication.findUniqueOrThrow.mockResolvedValue({
      domainId: "dom1",
      answers: { q: "challenge answer" },
      challengeFormVersionId: "chal-v",
      application: { answers: { g: "general" }, applicationFormVersionId: "app-v" },
    });
  });

  it("is not offered when the cycle binds no continued interest form", async () => {
    expect(await reuse({ cycle: { id: "c-now", continuedInterestFormId: null } })).toBe("not-offered");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("is not offered when the form has no published version", async () => {
    db.formVersion.findFirst.mockResolvedValue(null);

    expect(await reuse()).toBe("not-offered");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a domain application the applicant was not waitlisted on", async () => {
    expect(await reuse({ waitlistedDomainApplicationId: "someone-elses" })).toBe("not-found");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("creates a Draft application and copies the waitlisted answers and pinned form versions", async () => {
    expect(await reuse()).toBeNull();

    expect(tx.application.upsert).toHaveBeenCalledWith({
      where: { userId_applicationCycleId: { userId: "u1", applicationCycleId: "c-now" } },
      update: { answers: { g: "general" }, applicationFormVersionId: "app-v" },
      create: {
        userId: "u1",
        applicationCycleId: "c-now",
        startTermId: "term1",
        answers: { g: "general" },
        applicationFormVersionId: "app-v",
        statusUpdates: { create: { newStatus: "Draft", userId: "u1" } },
      },
      select: { id: true },
    });
    expect(tx.domainApplication.create).toHaveBeenCalledWith({
      data: {
        selected: true,
        answers: { q: "challenge answer" },
        challengeFormVersionId: "chal-v",
        continuedFromId: "wl1",
        continuedInterestFormVersionId: "fv-latest",
        applicationId: "newapp",
        domainId: "dom1",
      },
    });
  });

  it("updates the domain application the applicant already has for that domain and clears answers to a different form version", async () => {
    tx.domainApplication.findFirst.mockResolvedValue({ id: "da-existing", continuedInterestFormVersionId: "fv-old" });

    await reuse();

    expect(tx.domainApplication.create).not.toHaveBeenCalled();
    const arg = tx.domainApplication.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "da-existing" });
    expect(arg.data).toMatchObject({ continuedFromId: "wl1", continuedInterestFormVersionId: "fv-latest", selected: true });
    expect(arg.data.continuedInterestAnswers).toBe(Prisma.DbNull);
  });

  it("keeps continued interest answers when the form version has not changed", async () => {
    tx.domainApplication.findFirst.mockResolvedValue({ id: "da-existing", continuedInterestFormVersionId: "fv-latest" });

    await reuse();

    expect(tx.domainApplication.update.mock.calls[0][0].data).not.toHaveProperty("continuedInterestAnswers");
  });
});

describe("stopUsingWaitlistedApplication", () => {
  const stop = (cycle: Record<string, unknown> = {}) =>
    stopUsingWaitlistedApplication({
      applicationId: "app1",
      domainId: "dom1",
      cycle: { id: "c-now", hasChallenges: true, applicationFormId: "appform", ...cycle },
    });

  beforeEach(() => {
    db.domainApplication.findFirst.mockResolvedValue({ id: "da1" });
    db.cycleDomainForm.findFirst.mockResolvedValue({ formId: "chal-form" });
    db.formVersion.findFirst.mockImplementation(async ({ where }: any) => ({ id: `${where.formId}-latest` }));
  });

  it("does nothing for a domain application that is not a reuse", async () => {
    db.domainApplication.findFirst.mockResolvedValue(null);

    await stop();

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("resets the domain application to a blank answer on this cycle's own challenge", async () => {
    await stop();

    expect(tx.domainApplication.update).toHaveBeenCalledWith({
      where: { id: "da1" },
      data: {
        answers: {},
        challengeFormVersionId: "chal-form-latest",
        continuedFromId: null,
        continuedInterestFormVersionId: null,
        continuedInterestAnswers: Prisma.DbNull,
      },
    });
  });

  it("puts the general form back to the cycle's own once no domain still reuses a waitlisted application", async () => {
    tx.domainApplication.count.mockResolvedValue(0);

    await stop();

    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: "app1" },
      data: { answers: {}, applicationFormVersionId: "appform-latest" },
    });
  });

  it("keeps the reused general answers while another domain still reuses one", async () => {
    tx.domainApplication.count.mockResolvedValue(1);

    await stop();

    expect(tx.application.update).not.toHaveBeenCalled();
  });

  it("leaves the challenge version null when the cycle runs no challenges", async () => {
    await stop({ hasChallenges: false });

    expect(db.cycleDomainForm.findFirst).not.toHaveBeenCalled();
    expect(tx.domainApplication.update.mock.calls[0][0].data.challengeFormVersionId).toBeNull();
  });

  it("leaves the general form version null when the cycle has no application form", async () => {
    await stop({ applicationFormId: null });

    expect(tx.application.update.mock.calls[0][0].data.applicationFormVersionId).toBeNull();
  });
});

describe("loadContinuedInterestView", () => {
  it("is null for a domain application that is not a reuse", async () => {
    expect(
      await loadContinuedInterestView({ continuedFromId: null, continuedInterestFormVersionId: "fv", continuedInterestAnswers: {} }),
    ).toBeNull();
    expect(db.domainApplication.findUnique).not.toHaveBeenCalled();
  });

  it("returns the earlier cycle name, the form's questions and presigned answers", async () => {
    db.domainApplication.findUnique.mockResolvedValue({ application: { applicationCycle: { name: "26F" } } });
    db.formVersion.findUnique.mockResolvedValue({ questions: [{ id: "q1" }] });

    const view = await loadContinuedInterestView({
      continuedFromId: "wl1",
      continuedInterestFormVersionId: "fv",
      continuedInterestAnswers: { q1: "still keen" },
    });

    expect(view).toEqual({
      fromCycleName: "26F",
      questions: [{ id: "q1" }],
      answers: { q1: "still keen", presigned: "yes" },
    });
    expect(presignAnswers).toHaveBeenCalledWith([{ id: "q1" }], { q1: "still keen" });
  });

  it("falls back to a generic cycle name, no questions and empty answers when the source and form are gone", async () => {
    db.domainApplication.findUnique.mockResolvedValue(null);

    const view = await loadContinuedInterestView({
      continuedFromId: "wl1",
      continuedInterestFormVersionId: null,
      continuedInterestAnswers: null,
    });

    expect(view).toMatchObject({ fromCycleName: "an earlier cycle", questions: [] });
    expect(presignAnswers).toHaveBeenCalledWith([], {});
    expect(db.formVersion.findUnique).not.toHaveBeenCalled();
  });
});
