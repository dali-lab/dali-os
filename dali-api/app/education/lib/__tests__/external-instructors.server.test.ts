import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  currentTerm: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/promotion-notify.server", () => ({
  notifyAdminsOfPromotion: vi.fn(),
}));
vi.mock("~/lib/dartmouth-people", () => ({ peopleByNetId: vi.fn() }));
vi.mock("~/education/lib/access.server", () => ({
  isOfferingManager: vi.fn(),
  manageableOfferingIds: vi.fn(),
}));
vi.mock("~/education/lib/notifications.server", () => ({
  notifyExternalInstructorInvite: vi.fn(),
}));
vi.mock("~/education/lib/application-form.server", () => ({
  createOfferingApplicationForm: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, currentTerm } from "~/lib/roles";
import { peopleByNetId } from "~/lib/dartmouth-people";
import { isOfferingManager } from "~/education/lib/access.server";
import { notifyAdminsOfPromotion } from "~/lib/promotion-notify.server";
import { notifyExternalInstructorInvite } from "~/education/lib/notifications.server";
import { runOfferingAction } from "~/education/lib/offerings.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const PERSON = {
  dartmouthAffiliation: "DART",
  isAlum: false,
  isStudent: true,
  classYear: 2027,
  departmentClass: "'27",
};

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
    typeof fn === "function"
      ? (fn as (tx: unknown) => Promise<unknown>)(mockPrisma)
      : Promise.all(fn as Promise<unknown>[]),
  );
  // Preamble every switch intent runs: load the offering + pass the manager gate.
  mockPrisma.educationOffering.findUnique.mockResolvedValue({
    id: "off-1",
    title: "CS Design",
    sessions: [],
  });
  vi.mocked(isOfferingManager).mockResolvedValue(true);
  // Fire-and-forget notifiers are `void x().catch(...)`, so they must be promises.
  vi.mocked(notifyAdminsOfPromotion).mockResolvedValue(undefined as never);
  vi.mocked(notifyExternalInstructorInvite).mockResolvedValue(undefined);
});

describe("invite-external-instructor", () => {
  it("is Core-only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await runOfferingAction(
      fd({ intent: "invite-external-instructor", offeringId: "off-1", netId: "abc", firstName: "A", lastName: "B" }),
      "actor",
    );
    expect(res).toEqual({ error: "Core only", status: 403 });
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
  });

  it("rejects a NetID with no Dartmouth account", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(currentTerm).mockResolvedValue({ id: "term-1" } as never);
    vi.mocked(peopleByNetId).mockResolvedValue(null);
    const res = (await runOfferingAction(
      fd({ intent: "invite-external-instructor", offeringId: "off-1", netId: "ghost", firstName: "A", lastName: "B" }),
      "actor",
    )) as { status: number };
    expect(res.status).toBe(404);
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
  });

  it("upserts by NetID, assigns for the term, and emails the invite", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(currentTerm).mockResolvedValue({ id: "term-1" } as never);
    vi.mocked(peopleByNetId).mockResolvedValue(PERSON);
    mockPrisma.user.upsert.mockResolvedValue({
      id: "u1",
      firstName: "Ada",
      dartmouthEmail: "f00abc@dartmouth.edu",
      netId: "f00abc",
    });
    mockPrisma.instructorAssignment.findFirst.mockResolvedValue(null);

    const res = await runOfferingAction(
      fd({ intent: "invite-external-instructor", offeringId: "off-1", netId: "F00ABC", firstName: "Ada", lastName: "Lovelace" }),
      "actor",
    );

    expect(res).toEqual({ ok: true, id: "off-1" });
    // Upsert keyed on netId (lowercased) — converges with any existing row.
    expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { netId: "f00abc" } }),
    );
    expect(mockPrisma.instructorAssignment.create).toHaveBeenCalledWith({
      data: { userId: "u1", offeringId: "off-1", termId: "term-1" },
    });
    expect(notifyExternalInstructorInvite).toHaveBeenCalledWith(
      expect.objectContaining({ offeringId: "off-1", offeringTitle: "CS Design" }),
    );
  });

  it("is idempotent when already assigned this term (no re-create, no re-email)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(currentTerm).mockResolvedValue({ id: "term-1" } as never);
    vi.mocked(peopleByNetId).mockResolvedValue(PERSON);
    mockPrisma.user.upsert.mockResolvedValue({
      id: "u1",
      firstName: "Ada",
      dartmouthEmail: "f00abc@dartmouth.edu",
      netId: "f00abc",
    });
    mockPrisma.instructorAssignment.findFirst.mockResolvedValue({ id: "ia-1" });

    const res = await runOfferingAction(
      fd({ intent: "invite-external-instructor", offeringId: "off-1", netId: "f00abc", firstName: "Ada", lastName: "Lovelace" }),
      "actor",
    );

    expect(res).toEqual({ ok: true, id: "off-1" });
    expect(mockPrisma.instructorAssignment.create).not.toHaveBeenCalled();
    expect(notifyExternalInstructorInvite).not.toHaveBeenCalled();
  });
});

describe("set-instructors", () => {
  it("only replaces member instructors, leaving external ones intact", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(currentTerm).mockResolvedValue({ id: "term-1" } as never);
    mockPrisma.instructorAssignment.findMany.mockResolvedValue([]);

    await runOfferingAction(
      fd({ intent: "set-instructors", offeringId: "off-1" }),
      "actor",
    );

    expect(mockPrisma.instructorAssignment.deleteMany).toHaveBeenCalledWith({
      where: { offeringId: "off-1", user: { daliMember: { isNot: null } } },
    });
  });
});

describe("remove-external-instructor", () => {
  it("removes the assignment for that user on this offering", async () => {
    vi.mocked(isCore).mockResolvedValue(true);

    const res = await runOfferingAction(
      fd({ intent: "remove-external-instructor", offeringId: "off-1", userId: "ext-1" }),
      "actor",
    );

    expect(res).toEqual({ ok: true, id: "off-1" });
    expect(mockPrisma.instructorAssignment.deleteMany).toHaveBeenCalledWith({
      where: { offeringId: "off-1", userId: "ext-1" },
    });
  });
});
