import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Kept off the credential key so secret scanners don't read the fixture as a real one.
const ONE_TIME = vi.hoisted(() => "provisioned-once");

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn(async () => undefined) }));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "om-1", deduped: false })),
  drainNow: vi.fn(async () => undefined),
}));
vi.mock("~/members/lib/membership.server", () => ({
  promoteToMember: vi.fn(async () => ({ created: true })),
}));
vi.mock("~/members/lib/provisioning.server", () => ({
  provisionNewMember: vi.fn(async () => ({
    workspace: { status: "ok", message: "" },
    slack: { status: "skipped", message: "" },
    github: { status: "skipped", message: "" },
    daliEmail: "ada.lovelace@dali.dartmouth.edu",
    daliTempPassword: ONE_TIME,
  })),
}));
vi.mock("~/members/lib/welcome.server", () => ({
  sendWelcome: vi.fn(async () => ({ notified: true })),
  onboardingEmailHtml: vi.fn(
    async (
      daliEmail: string | null,
      tempPassword: string | null = null,
      vars: { startTerm?: string; respondBy?: string } = {},
    ) => `<onboarding dali="${daliEmail ?? ""}" pw="${tempPassword ?? ""}" term="${vars.startTerm ?? ""}" by="${vars.respondBy ?? ""}"/>`,
  ),
}));
vi.mock("~/hiring/lib/hiring-emails.server", () => ({ getHiringEmail: vi.fn() }));
vi.mock("~/email/lib/templates.server", () => ({ getEmailTemplate: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { enqueueOutbound } from "~/lib/outbound.server";
import { promoteToMember } from "~/members/lib/membership.server";
import { onboardingEmailHtml } from "~/members/lib/welcome.server";
import { getHiringEmail } from "~/hiring/lib/hiring-emails.server";
import { getEmailTemplate } from "~/email/lib/templates.server";
import { acceptFromWaitlist } from "~/hiring/lib/waitlist.server";

// 11:59:59 PM Eastern, Monday June 8 2026.
const OFFER_BY = new Date("2026-06-09T03:59:59.999Z");

const db = prisma as any;

function setupWaitlisted(
  opts: { startTermCode?: string | null; cycleTermCode?: string | null; offerRespondBy?: Date | null } = {},
) {
  const tx = {
    applicationCycleStatusUpdate: { create: vi.fn() },
    decision: { create: vi.fn(async () => ({ id: "dec-released" })), update: vi.fn() },
    domainApplication: { findMany: vi.fn(async () => []) },
  };
  db.domainApplication = {
    findUnique: vi.fn(async () => ({
      id: "da-1",
      domain: { id: "dom-1", name: "Engineering", displayName: "Engineering" },
      application: {
        applicationCycleId: "cycle-1",
        userId: "applicant-1",
        user: { firstName: "Ada", dartmouthEmail: "ada@dartmouth.edu", netId: null },
        startTerm: opts.startTermCode ? { code: opts.startTermCode } : null,
        applicationCycle: {
          offerRespondBy: opts.offerRespondBy ?? null,
          waitlistRespondBy: null,
          term: opts.cycleTermCode ? { code: opts.cycleTermCode } : null,
        },
      },
      decisions: [{ id: "dec-waitlisted", type: "Waitlisted", waitlistRank: 1 }],
    })),
  };
  db.applicationCycleStatusUpdate = { findFirst: vi.fn(async () => ({ newStatus: "UnderReview" })) };
  db.$transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
  return tx;
}

function templates(letter: { subject: string; body: string }, nextStepsBody = "Next steps.") {
  vi.mocked(getHiringEmail).mockResolvedValue(letter);
  vi.mocked(getEmailTemplate).mockResolvedValue({ subject: "Next steps", body: nextStepsBody });
}

function accept() {
  return acceptFromWaitlist({
    domainApplicationId: "da-1",
    actorId: "lead-1",
    request: new Request("http://localhost/api/waitlist/da-1/accept", { method: "POST" }),
  });
}

function sentEmail() {
  return vi.mocked(enqueueOutbound).mock.calls[0]?.[0] as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("acceptFromWaitlist — acceptance email", () => {
  it("appends the awaited onboarding block, never a Promise", async () => {
    setupWaitlisted({ startTermCode: "27W", offerRespondBy: OFFER_BY });
    templates({ subject: "Welcome, {{firstName}}", body: "You're in." });

    const result = await accept();
    expect(result).toMatchObject({ ok: true, releasedDecisionId: "dec-released" });
    expect(sentEmail().subject).toBe("Welcome, Ada");
    expect(sentEmail().bodyHtml).toContain(`<onboarding dali="ada.lovelace@dali.dartmouth.edu" pw="${ONE_TIME}"`);
    expect(sentEmail().bodyHtml).not.toContain("[object Promise]");
  });

  it("fills {{startTerm}} and {{respondBy}} into the letter and the next-steps block", async () => {
    setupWaitlisted({ startTermCode: "27W", cycleTermCode: "26F", offerRespondBy: OFFER_BY });
    templates({ subject: "Starting {{startTerm}}", body: "Reply by {{respondBy}}." }, "By {{respondBy}}");

    await accept();
    expect(sentEmail().subject).toBe("Starting 27W");
    expect(sentEmail().bodyHtml).toContain("Reply by Monday, June 8, 2026.");
    expect(vi.mocked(onboardingEmailHtml)).toHaveBeenCalledWith("ada.lovelace@dali.dartmouth.edu", ONE_TIME, {
      startTerm: "27W",
      respondBy: "Monday, June 8, 2026",
    });
  });

  it("falls back to the cycle's term when the applicant didn't pick one", async () => {
    setupWaitlisted({ startTermCode: null, cycleTermCode: "26F" });
    templates({ subject: "Welcome", body: "Starting in {{startTerm}}." });

    await accept();
    expect(sentEmail().bodyHtml).toContain("Starting in 26F.");
  });

  it("refuses before any write when the letter quotes {{respondBy}} and the cycle has no offer date", async () => {
    const tx = setupWaitlisted({ startTermCode: "27W" });
    templates({ subject: "Welcome", body: "Reply by {{respondBy}}." });

    const result = await accept();
    expect(result).toMatchObject({ ok: false, reason: "email-vars" });
    expect((result as any).message).toMatch(/no offer response date/);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.decision.create).not.toHaveBeenCalled();
    expect(promoteToMember).not.toHaveBeenCalled();
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("refuses when only the next-steps block quotes {{respondBy}}", async () => {
    setupWaitlisted({ startTermCode: "27W" });
    templates({ subject: "Welcome", body: "Hi" }, "Accept by {{respondBy}}.");

    expect(await accept()).toMatchObject({ ok: false, reason: "email-vars" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses once the offer deadline has passed, the usual case for a late waitlist accept", async () => {
    setupWaitlisted({ startTermCode: "27W", offerRespondBy: OFFER_BY });
    templates({ subject: "Welcome", body: "Reply by {{respondBy}}." });
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));

    const result = await accept();
    expect(result).toMatchObject({ ok: false, reason: "email-vars" });
    expect((result as any).message).toMatch(/has passed/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("accepts with no dates set when no template uses them", async () => {
    setupWaitlisted();
    templates({ subject: "Welcome", body: "Hi {{firstName}}" });

    expect(await accept()).toMatchObject({ ok: true });
    expect(vi.mocked(onboardingEmailHtml)).toHaveBeenCalledWith("ada.lovelace@dali.dartmouth.edu", ONE_TIME, {});
  });
});
