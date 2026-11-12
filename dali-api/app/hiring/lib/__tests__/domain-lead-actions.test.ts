import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/hiring/lib/cycle-rosters.server", () => ({ addDomainMentors: vi.fn(), domainMentorIds: vi.fn() }));
vi.mock("~/hiring/lib/application-form.server", () => ({ addDomainChallenge: vi.fn(), removeDomainChallenge: vi.fn() }));
vi.mock("~/hiring/lib/domain-windows.server", () => ({ setDomainReady: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { addDomainMentors, domainMentorIds } from "~/hiring/lib/cycle-rosters.server";
import { DOMAIN_LEAD_ACTIONS, resolveLeadDomain } from "~/hiring/lib/domain-lead-actions.server";
import { setDomainRubric } from "~/hiring/lib/domain-rubric.server";
import { LEAD_CYCLE_ACTIONS } from "~/hiring/lib/lead-cycle-actions.server";

const db = prisma as unknown as Record<string, any>;
const request = new Request("http://localhost/x", { method: "POST" });

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.domainApplicationCycle = { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) };
  db.applicationReview = { count: vi.fn().mockResolvedValue(0) };
  db.rubricVersion = { findUnique: vi.fn().mockResolvedValue({ id: "rv1" }) };
  db.domainLeadAssignment = { findFirst: vi.fn() };
  db.cycleDomainForm = { findUnique: vi.fn() };
});

describe("resolveLeadDomain", () => {
  it("returns the domain when the user leads it", async () => {
    db.domainLeadAssignment.findFirst.mockResolvedValue({ id: "a" });
    expect(await resolveLeadDomain(form({ intent: "set-rubric", domainId: "d1" }), "u1")).toBe("d1");
  });
  it("returns null for a non-lead or a missing domain", async () => {
    db.domainLeadAssignment.findFirst.mockResolvedValue(null);
    expect(await resolveLeadDomain(form({ domainId: "d1" }), "u1")).toBeNull();
    expect(await resolveLeadDomain(form({}), "u1")).toBeNull();
  });
  it("resolves remove-challenge-form through the link's domain", async () => {
    db.cycleDomainForm.findUnique.mockResolvedValue({ domainId: "d9" });
    db.domainLeadAssignment.findFirst.mockResolvedValue({ id: "a" });
    expect(await resolveLeadDomain(form({ intent: "remove-challenge-form", cdfId: "c1" }), "u1")).toBe("d9");
  });
});

describe("domain lead add-domain-mentors", () => {
  const run = (values: Record<string, string>) =>
    DOMAIN_LEAD_ACTIONS["add-domain-mentors"]({ request, formData: form(values), domainId: "d1", actorId: "u1" }) as Promise<any>;

  it("rejects an unknown role", async () => {
    expect((await run({ cycleId: "c1", role: "boss" })).status).toBe(400);
  });
  it("rejects a domain that isn't in the cycle", async () => {
    db.domainApplicationCycle.findUnique.mockResolvedValue(null);
    expect((await run({ cycleId: "c1", role: "reviewer" })).status).toBe(400);
    expect(addDomainMentors).not.toHaveBeenCalled();
  });
  it.each([
    [2, [], "Added 2 mentors."],
    [1, [], "Added 1 mentor."],
    [0, ["m1"], "Everyone's already on the roster."],
    [0, [], "This domain has no mentors yet."],
  ])("added=%s mentors=%j says %s", async (added, ids, notice) => {
    db.domainApplicationCycle.findUnique.mockResolvedValue({ domainId: "d1" });
    vi.mocked(addDomainMentors).mockResolvedValue(added);
    vi.mocked(domainMentorIds).mockResolvedValue(ids as never);
    expect(await run({ cycleId: "c1", role: "interviewer" })).toEqual({ notice });
  });
});

describe("setDomainRubric", () => {
  const args = { cycleId: "c1", domainId: "d1", rubricVersionId: "rv1", actorId: "u1", request };

  it("is locked once reviews exist and writes nothing", async () => {
    db.applicationReview.count.mockResolvedValue(1);
    expect(await setDomainRubric(args)).toBe("locked");
    expect(db.domainApplicationCycle.update).not.toHaveBeenCalled();
  });
  it("writes nothing for an unknown rubric version", async () => {
    db.rubricVersion.findUnique.mockResolvedValue(null);
    expect(await setDomainRubric(args)).toBe("rubric-not-found");
    expect(db.domainApplicationCycle.update).not.toHaveBeenCalled();
  });
  it("never creates the link for a domain outside the cycle", async () => {
    db.domainApplicationCycle.findUnique.mockResolvedValue(null);
    expect(await setDomainRubric(args)).toBe("not-in-cycle");
    expect(db.domainApplicationCycle.update).not.toHaveBeenCalled();
  });
  it("clears the rubric when none is given, without checking versions", async () => {
    db.domainApplicationCycle.findUnique.mockResolvedValue({ rubricVersionId: "rv0" });
    expect(await setDomainRubric({ ...args, rubricVersionId: null })).toBe("ok");
    expect(db.rubricVersion.findUnique).not.toHaveBeenCalled();
    expect(db.domainApplicationCycle.update.mock.calls[0][0].data).toEqual({ rubricVersionId: null });
  });

  it("writes the same audit from both lead pages", async () => {
    db.domainApplicationCycle.findUnique.mockResolvedValue({ rubricVersionId: "rv0" });
    await DOMAIN_LEAD_ACTIONS["set-rubric"]({
      request,
      formData: form({ cycleId: "c1", rubricVersionId: "rv1" }),
      domainId: "d1",
      actorId: "u1",
    });
    await LEAD_CYCLE_ACTIONS["hl-set-domain-rubric"]({
      request,
      formData: form({ domainId: "d1", rubricVersionId: "rv1" }),
      intent: "hl-set-domain-rubric",
      cycleId: "c1",
      actorId: "u1",
      applicants: "Students",
    });
    const calls = vi.mocked(logAuditEvent).mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).toMatchObject({ action: "domain.rubric.set", targetId: "d1", metadata: { cycleId: "c1", before: "rv0", after: "rv1" } });
  });
});
