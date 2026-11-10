import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/education/lib/notifications.server", () => ({ notifyApplicationStatus: vi.fn() }));
vi.mock("~/forms/lib/submission-notify.server", () => ({ notifyFormSubmission: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { submitApplication } from "~/education/lib/apply.server";
import { withdrawApplication } from "~/education/lib/decisions.server";
import { makeOffering, makeUser } from "../../../../integration/factories-misc";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
});

const apply = (offeringId: string, userId: string) => submitApplication({ offeringId, userId, answers: { q1: "hi" } });

describe("submitApplication capacity (RSVP offering)", () => {
  it("admits exactly capacity under concurrent applies and waitlists the rest FIFO-ranked uniquely", async () => {
    const creator = await makeUser();
    const offering = await makeOffering(creator.id, { capacity: 3 });
    const users = await Promise.all(Array.from({ length: 7 }, () => makeUser()));

    const results = await Promise.all(users.map((u) => apply(offering.id, u.id)));
    expect(results.every((r) => "ok" in r)).toBe(true);

    const rows = await prisma.educationApplication.findMany({ where: { offeringId: offering.id } });
    expect(rows).toHaveLength(7);
    expect(rows.filter((r) => r.status === "Approved")).toHaveLength(3);
    const waitlisted = rows.filter((r) => r.status === "Waitlisted");
    expect(waitlisted).toHaveLength(4);
    expect(waitlisted.map((r) => r.waitlistRank).sort()).toEqual([1, 2, 3, 4]);
    expect(rows.filter((r) => r.status === "Approved").every((r) => r.waitlistRank === null)).toBe(true);
  });

  it("review-required offerings land Submitted regardless of capacity", async () => {
    const creator = await makeUser();
    const offering = await makeOffering(creator.id, { capacity: 1, requiresReview: true });
    const users = await Promise.all([makeUser(), makeUser(), makeUser()]);
    await Promise.all(users.map((u) => apply(offering.id, u.id)));
    const statuses = await prisma.educationApplication.findMany({ where: { offeringId: offering.id }, select: { status: true } });
    expect(statuses.map((s) => s.status)).toEqual(["Submitted", "Submitted", "Submitted"]);
  });
});

describe("duplicate prevention", () => {
  it("double-submit by one user leaves a single application and rejects the second as already applied", async () => {
    const creator = await makeUser();
    const offering = await makeOffering(creator.id, { capacity: 5 });
    const user = await makeUser();
    expect(await apply(offering.id, user.id)).toEqual({ ok: true, status: "Approved" });
    expect(await apply(offering.id, user.id)).toMatchObject({ status: 409 });
    expect(await prisma.educationApplication.count({ where: { offeringId: offering.id } })).toBe(1);
    expect(await prisma.formSubmission.count()).toBe(1);
  });

  it("the (applicant, offering) unique constraint rejects a raw second row", async () => {
    const creator = await makeUser();
    const offering = await makeOffering(creator.id);
    const user = await makeUser();
    const data = { applicantUserId: user.id, offeringId: offering.id, status: "Submitted" as const };
    await prisma.educationApplication.create({ data });
    await expect(prisma.educationApplication.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("withdraw and re-apply", () => {
  it("withdrawing frees the seat and a withdrawn applicant re-applies on the same row, waitlisted when full", async () => {
    const creator = await makeUser();
    const offering = await makeOffering(creator.id, { capacity: 1 });
    const [a, b] = [await makeUser(), await makeUser()];
    expect(await apply(offering.id, a.id)).toEqual({ ok: true, status: "Approved" });
    const first = await prisma.educationApplication.findFirstOrThrow({ where: { applicantUserId: a.id } });

    expect(await withdrawApplication({ userId: a.id, offeringId: offering.id })).toHaveProperty("ok");
    expect((await prisma.educationApplication.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("Withdrawn");

    expect(await apply(offering.id, b.id)).toEqual({ ok: true, status: "Approved" });
    expect(await apply(offering.id, a.id)).toEqual({ ok: true, status: "Waitlisted" });

    const again = await prisma.educationApplication.findMany({ where: { applicantUserId: a.id } });
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: first.id, status: "Waitlisted", waitlistRank: 1 });
    expect(await prisma.formSubmission.count({ where: { userId: a.id } })).toBe(1);
  });
});
