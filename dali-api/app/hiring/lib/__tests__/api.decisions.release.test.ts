import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "om-test", deduped: false })),
  drainNow: vi.fn(async () => {}),
}));
// Acceptance side-effects (promote/welcome/provision) are exercised by their
// own unit tests; stub them here so this suite stays focused on the decision
// email + released-row behavior.
vi.mock("~/members/lib/membership.server", () => ({
  promoteToMember: vi.fn().mockResolvedValue({ created: true }),
}));
vi.mock("~/members/lib/welcome.server", () => ({
  sendWelcome: vi.fn().mockResolvedValue({ notified: true }),
  // Async like the real one: a sync stub is what let a missing `await` ship
  // "[object Promise]" in place of the onboarding block.
  onboardingEmailHtml: vi.fn(
    async (
      daliEmail: string | null,
      tempPassword: string | null = null,
      vars: { startTerm?: string; respondBy?: string } = {},
    ) =>
      `<onboarding dali="${daliEmail ?? ""}" pw="${tempPassword ?? ""}" term="${vars.startTerm ?? ""}" by="${vars.respondBy ?? ""}"/>`,
  ),
}));
vi.mock("~/members/lib/provisioning.server", () => ({
  provisionNewMember: vi.fn().mockResolvedValue({
    github: { status: "skipped", message: "" },
    slack: { status: "skipped", message: "" },
    gmail: { status: "skipped", message: "" },
    daliEmail: null,
    daliTempPassword: null,
  }),
}));
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { promoteToMember } from "~/members/lib/membership.server";
import { sendWelcome } from "~/members/lib/welcome.server";
import { provisionNewMember } from "~/members/lib/provisioning.server";
import { onboardingEmailHtml } from "~/members/lib/welcome.server";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/hiring/routes/api.decisions.$id.release";

const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;

const mockPrisma = prisma as unknown as {
  dALIMember: { findUnique: ReturnType<typeof vi.fn> };
  decision: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  domainApplication: {
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  emailTemplate: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  gmailIntegration: { findFirst: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-hl";
const MEMBER_ID = "member-hl";
const DECISION_ID = "dec-1";
const CYCLE_ID = "cycle-1";

function setupAuth() {
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: MEMBER_ID, userId: USER_ID });
}

function setupFinalDecision(type: "Rejected" | "InvitedToInterview" | "Accepted" | "Waitlisted" = "Accepted") {
  mockPrisma.decision.findUnique.mockResolvedValue({
    id: DECISION_ID,
    stage: "Final",
    type,
    domainApplicationId: "da-1",
    notes: null,
    waitlistRank: null,
  });
  mockPrisma.decision.create.mockResolvedValue({
    id: "dec-released",
    stage: "Released",
    type,
  });
}

function setupApplicantContext(
  opts: {
    domainName?: string | null;
    startTermCode?: string | null;
    cycleTermCode?: string | null;
    offerRespondBy?: Date | null;
    waitlistRespondBy?: Date | null;
  } = {},
) {
  const domainName = opts.domainName === undefined ? "Engineering" : opts.domainName;
  mockPrisma.domainApplication.findUnique.mockResolvedValue({
    id: "da-1",
    domain: domainName ? { id: "dom-1", name: domainName, displayName: domainName } : null,
    application: {
      userId: "applicant-user-id",
      applicationCycleId: CYCLE_ID,
      startTerm: opts.startTermCode ? { code: opts.startTermCode } : null,
      applicationCycle: {
        applicants: "Students",
        term: opts.cycleTermCode ? { code: opts.cycleTermCode } : null,
        offerRespondBy: opts.offerRespondBy ?? null,
        waitlistRespondBy: opts.waitlistRespondBy ?? null,
      },
      user: {
        firstName: "Ada",
        dartmouthEmail: "ada@dartmouth.edu",
        netId: null,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Candidate emails redirect to a test inbox outside prod; these tests assert
  // the real-recipient + template behavior, so pin the env to prod. The
  // dev-redirect path is asserted in its own test below.
  process.env.DALI_APP_ENV = "prod";
  (mockPrisma as any).dALIMember = { findUnique: vi.fn() };
  (mockPrisma as any).decision = { findUnique: vi.fn(), create: vi.fn() };
  (mockPrisma as any).domainApplication = {
    findUnique: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  (mockPrisma as any).emailTemplate = { findUnique: vi.fn() };
  (mockPrisma as any).user = { findUnique: vi.fn() };
  (mockPrisma as any).gmailIntegration = { findFirst: vi.fn() };
});

afterAll(() => {
  delete process.env.DALI_APP_ENV;
});

function makeRequest() {
  return new Request("http://localhost/api/decisions/dec-1/release", { method: "POST" });
}

describe("POST /api/hiring/decisions/:id/release", () => {
  it("sends the shared Accepted email", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext();
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "Welcome, {{firstName}}!", body: "Hi {{firstName}},\n\nYou're in." });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);

    // Hiring slots now resolve through the unified store, keyed by the slot
    // prefixed with its area (the bare slot collided with education's).
    expect(mockPrisma.emailTemplate.findUnique).toHaveBeenCalledWith({
      where: { key: "hiring:decision:Accepted" },
    });

    const emailCall = mockEnqueue.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.channel === "email");
    expect(emailCall).toBeDefined();
    expect(emailCall.target).toBe("ada@dartmouth.edu");
    expect(emailCall.subject).toBe("Welcome, Ada!");
    expect(emailCall.bodyHtml).toContain("Hi Ada,");
    // The onboarding block is appended to the Accepted decision email so the
    // member gets a single email (no separate welcome message).
    expect(emailCall.bodyHtml).toContain("<onboarding");
    expect(emailCall.bodyHtml).not.toContain("[object Promise]");
  });

  it("interpolates {{domain}} from domainApplication.domain.name", async () => {
    setupAuth();
    setupFinalDecision("Rejected");
    setupApplicantContext({ domainName: "Design" });
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "Your {{domain}} application", body: "Hi {{firstName}}, regarding {{domain}}." });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    const emailCall = mockEnqueue.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.channel === "email");
    expect(emailCall.subject).toBe("Your Design application");
    expect(emailCall.bodyHtml).toContain("Hi Ada, regarding Design.");
  });

  it("refuses to release when the domain application has no linked domain at all", async () => {
    // A DomainApplication must have either a challengeVersion → domain (Standard)
    // or a direct `domain` (InternToFull). If both are missing the data is
    // corrupt; the route fails closed rather than emailing an empty {{domain}}.
    setupAuth();
    setupFinalDecision("Rejected");
    setupApplicantContext({ domainName: null });
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "About {{domain}}", body: "{{firstName}} / {{domain}}" });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(409);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns 409 and does not create the released decision when there's no email for that decision", async () => {
    setupAuth();
    setupFinalDecision("Rejected");
    setupApplicantContext();
    mockPrisma.emailTemplate.findUnique.mockResolvedValue(null);

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Rejected/);
    expect(body.error).toMatch(/Setup tab/);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns 409 when the decision is not Final", async () => {
    setupAuth();
    mockPrisma.decision.findUnique.mockResolvedValue({
      id: DECISION_ID,
      stage: "Draft",
      type: "Accepted",
      domainApplicationId: "da-1",
      notes: null,
      waitlistRank: null,
    });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(409);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not a hiring lead", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: USER_ID } } as any);
    vi.mocked(isCore).mockResolvedValue(false);

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(403);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("falls back to netId@dartmouth.edu when dartmouthEmail is missing", async () => {
    setupAuth();
    setupFinalDecision("InvitedToInterview");
    mockPrisma.domainApplication.findUnique.mockResolvedValue({
      id: "da-1",
      domain: { id: "dom-1", name: "Engineering", displayName: "Engineering" },
      application: {
        userId: "applicant-user-id",
        applicationCycleId: CYCLE_ID,
        applicationCycle: { applicants: "Students" },
        user: {
          firstName: "Grace",
          dartmouthEmail: null,
          netId: "f00abc",
        },
      },
    });
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "Interview invite", body: "Hi {{firstName}}" });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    const emailCall = mockEnqueue.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.channel === "email");
    expect(emailCall).toBeDefined();
    expect(emailCall.target).toBe("f00abc@dartmouth.edu");
  });

  it("does not throw when enqueueOutbound fails", async () => {
    setupAuth();
    setupFinalDecision("Waitlisted");
    setupApplicantContext();
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "x", body: "y" });
    mockEnqueue.mockRejectedValueOnce(new Error("outbox down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("in non-prod, enqueues the decision email to the real recipient (redirect is drain's job)", async () => {
    // The route always enqueues the real recipient's address. The staging/dev
    // redirect (to the test inbox + banner) is handled downstream by drainNow,
    // not by the release route itself.
    process.env.DALI_APP_ENV = "dev";
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext();
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "Welcome!", body: "Hi {{firstName}}" });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    const emailCall = mockEnqueue.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.channel === "email");
    expect(emailCall).toBeDefined();
    // The enqueued row now names the real applicant, and env safety is entirely
    // the transport's: it redirects To: and injects the banner. Previously the
    // producer ALSO redirected and prepended its own banner, so staging mail had
    // two of them and the transport's banner reported the test inbox as the
    // "original" recipient rather than the applicant.
    expect(emailCall.target).toBe("ada@dartmouth.edu");
    expect(emailCall.bodyHtml).not.toContain("Test environment");
  });

  it("on Accepted, promotes to member, provisions, and sends welcome — all for the applicant", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext();
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "Welcome!", body: "Hi {{firstName}}" });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);

    // Promotes the APPLICANT (not the acting lead) into the target domain at P1.
    expect(promoteToMember).toHaveBeenCalledOnce();
    expect(vi.mocked(promoteToMember).mock.calls[0][0]).toMatchObject({
      userId: "applicant-user-id",
      domainId: "dom-1",
      level: "P1",
      actorId: USER_ID,
    });

    // Provisions external accounts for the applicant in the target domain.
    expect(provisionNewMember).toHaveBeenCalledOnce();
    expect(vi.mocked(provisionNewMember).mock.calls[0][0]).toMatchObject({
      userId: "applicant-user-id",
      domainId: "dom-1",
    });

    // Welcomes the applicant at a reachable address.
    expect(sendWelcome).toHaveBeenCalledOnce();
    expect(vi.mocked(sendWelcome).mock.calls[0][0]).toMatchObject({
      userId: "applicant-user-id",
      email: "ada@dartmouth.edu",
    });
  });

  it("on Accepted, closes the applicant's other undecided domains this cycle (single placement)", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext();
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "Welcome!", body: "Hi {{firstName}}" });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);

    expect(mockPrisma.domainApplication.updateMany).toHaveBeenCalledOnce();
    const arg = vi.mocked(mockPrisma.domainApplication.updateMany).mock.calls[0][0];
    // Only sibling DAs (not this one), still selected, undecided, not already closed.
    expect(arg.where).toMatchObject({
      id: { not: "da-1" },
      selected: true,
      closureReason: null,
      decisions: { none: { stage: "Released" } },
    });
    expect(arg.data).toMatchObject({ closureReason: "AcceptedElsewhere" });
  });

  it("does NOT close siblings for a non-Accepted decision", async () => {
    setupAuth();
    setupFinalDecision("Rejected");
    setupApplicantContext();
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "Update", body: "Hi {{firstName}}" });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    expect(mockPrisma.domainApplication.updateMany).not.toHaveBeenCalled();
  });

  it("folds the provisioned daliEmail into the welcome call", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext();
    vi.mocked(provisionNewMember).mockResolvedValueOnce({
      daliEmail: "ada.lovelace@dali.dartmouth.edu",
      github: { status: "skipped", message: "" },
      slack: { status: "skipped", message: "" },
      gmail: { status: "skipped", message: "" },
    } as any);
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "Welcome!", body: "Hi {{firstName}}" });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    expect(vi.mocked(sendWelcome).mock.calls[0][0].daliEmail).toBe(
      "ada.lovelace@dali.dartmouth.edu",
    );
  });

  it("renders the temp password into the onboarding email but NEVER into the audit log", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext();
    vi.mocked(provisionNewMember).mockResolvedValueOnce({
      daliEmail: "ada.lovelace@dali.dartmouth.edu",
      daliTempPassword: "s3cr3t-temp-pw",
      github: { status: "skipped", message: "" },
      slack: { status: "skipped", message: "" },
    } as any);
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "Welcome!", body: "Hi {{firstName}}" });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);

    // The temp password is passed to onboardingEmailHtml (→ into the email body).
    expect(vi.mocked(onboardingEmailHtml)).toHaveBeenCalledWith(
      "ada.lovelace@dali.dartmouth.edu",
      "s3cr3t-temp-pw",
      {},
    );

    // …and it must NOT appear anywhere in the audit metadata.
    const auditMeta = vi.mocked(logAuditEvent).mock.calls.at(-1)?.[0].metadata;
    const serialized = JSON.stringify(auditMeta);
    expect(serialized).not.toContain("s3cr3t-temp-pw");
    expect(serialized).not.toContain("daliTempPassword");
  });

  it("does NOT promote / provision / welcome for non-Accepted decisions", async () => {
    setupAuth();
    setupFinalDecision("Rejected");
    setupApplicantContext();
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "x", body: "y" });

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    expect(promoteToMember).not.toHaveBeenCalled();
    expect(provisionNewMember).not.toHaveBeenCalled();
    expect(sendWelcome).not.toHaveBeenCalled();
    // …but the decision email still goes out — without the onboarding block.
    const emailCall = mockEnqueue.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.channel === "email");
    expect(emailCall).toBeDefined();
    expect(emailCall.bodyHtml).not.toContain("<onboarding");
  });

  it("still releases (201) when provisioning throws — failure is isolated", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext();
    vi.mocked(provisionNewMember).mockRejectedValueOnce(new Error("workspace 500"));
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "Welcome!", body: "Hi {{firstName}}" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
    expect(res.status).toBe(201);
    // promotion ran before provisioning; welcome still runs after the catch.
    expect(promoteToMember).toHaveBeenCalledOnce();
    expect(sendWelcome).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });
});

describe("POST /api/hiring/decisions/:id/release — {{startTerm}} and {{respondBy}}", () => {
  // 11:59:59 PM Eastern, Monday June 8 2026 / Friday January 15 2027.
  const OFFER_BY = new Date("2026-06-09T03:59:59.999Z");
  const WAITLIST_BY = new Date("2027-01-16T04:59:59.999Z");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The decision letter and the appended next-steps block are separate templates.
  function templates(letter: { subject: string; body: string }, nextStepsBody = "Next steps.") {
    mockPrisma.emailTemplate.findUnique.mockImplementation(async ({ where }: any) =>
      where.key === "hiring:onboarding:NextSteps" ? { subject: "Next steps", body: nextStepsBody } : letter,
    );
  }

  async function release() {
    return action({ request: makeRequest(), params: { id: DECISION_ID }, context: {} } as any);
  }

  function sentEmail() {
    return mockEnqueue.mock.calls.map((c: any[]) => c[0]).find((a: any) => a.channel === "email");
  }

  it("fills the applicant's start term and the offer deadline into the Accepted letter", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext({ startTermCode: "27W", cycleTermCode: "26F", offerRespondBy: OFFER_BY });
    templates({ subject: "Join us in {{startTerm}}", body: "Reply by {{respondBy}}." });

    const res = await release();
    expect(res.status).toBe(201);
    expect(sentEmail().subject).toBe("Join us in 27W");
    expect(sentEmail().bodyHtml).toContain("Reply by Monday, June 8, 2026.");
  });

  it("falls back to the cycle's term when the applicant didn't pick a start term", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext({ startTermCode: null, cycleTermCode: "26F", offerRespondBy: OFFER_BY });
    templates({ subject: "Welcome", body: "Starting in {{startTerm}}." });

    await release();
    expect(sentEmail().bodyHtml).toContain("Starting in 26F.");
  });

  it("passes the same values to the next-steps block and appends it awaited", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext({ startTermCode: "27W", offerRespondBy: OFFER_BY });
    templates({ subject: "Welcome", body: "Hi" }, "Deadline {{respondBy}} for {{startTerm}}");

    await release();
    expect(vi.mocked(onboardingEmailHtml)).toHaveBeenCalledWith(null, null, {
      startTerm: "27W",
      respondBy: "Monday, June 8, 2026",
    });
    expect(sentEmail().bodyHtml).toContain('term="27W" by="Monday, June 8, 2026"');
    expect(sentEmail().bodyHtml).not.toContain("[object Promise]");
  });

  it("fills the waitlist deadline into the Waitlisted letter", async () => {
    setupAuth();
    setupFinalDecision("Waitlisted");
    setupApplicantContext({ offerRespondBy: OFFER_BY, waitlistRespondBy: WAITLIST_BY });
    templates({ subject: "Waitlist", body: "Opt in by {{respondBy}}." });

    const res = await release();
    expect(res.status).toBe(201);
    expect(sentEmail().bodyHtml).toContain("Opt in by Friday, January 15, 2027.");
  });

  it("refuses an Accepted release whose letter quotes {{respondBy}} when the cycle has no offer date", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext({ startTermCode: "27W" });
    templates({ subject: "Welcome", body: "Reply by {{respondBy}}." });

    const res = await release();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no offer response date/);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
    expect(promoteToMember).not.toHaveBeenCalled();
    expect(provisionNewMember).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("refuses when only the next-steps block quotes {{respondBy}}", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext({ startTermCode: "27W" });
    templates({ subject: "Welcome", body: "Hi {{firstName}}" }, "Accept by {{respondBy}}.");

    const res = await release();
    expect(res.status).toBe(409);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
  });

  it("refuses once the offer deadline has passed", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext({ startTermCode: "27W", offerRespondBy: OFFER_BY });
    templates({ subject: "Welcome", body: "Reply by {{respondBy}}." });
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));

    const res = await release();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/has passed/);
    expect(mockPrisma.decision.create).not.toHaveBeenCalled();
  });

  it("refuses an Accepted letter quoting {{startTerm}} when neither the application nor the cycle has a term", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext({ startTermCode: null, cycleTermCode: null, offerRespondBy: OFFER_BY });
    templates({ subject: "Welcome", body: "Starting in {{startTerm}}." });

    const res = await release();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/\{\{startTerm\}\}/);
  });

  it("refuses a Waitlisted release quoting {{respondBy}} with no waitlist date, even with an offer date", async () => {
    setupAuth();
    setupFinalDecision("Waitlisted");
    setupApplicantContext({ offerRespondBy: OFFER_BY });
    templates({ subject: "Waitlist", body: "Opt in by {{respondBy}}." });

    const res = await release();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no waitlist response date/);
  });

  it("doesn't check the next-steps block for a Waitlisted release", async () => {
    setupAuth();
    setupFinalDecision("Waitlisted");
    setupApplicantContext({ waitlistRespondBy: WAITLIST_BY });
    templates({ subject: "Waitlist", body: "Hi" }, "Accept by {{respondBy}}.");

    const res = await release();
    expect(res.status).toBe(201);
  });

  it("releases a letter that uses neither token with no dates set", async () => {
    setupAuth();
    setupFinalDecision("Accepted");
    setupApplicantContext();
    templates({ subject: "Welcome", body: "Hi {{firstName}}" });

    const res = await release();
    expect(res.status).toBe(201);
  });
});
