import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/hiring/lib/cycles");
vi.mock("~/lib/submission-check", () => ({
  checkGitHubUrl: vi.fn(),
  checkFigmaUrl: vi.fn(),
}));
vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(),
  drainNow: vi.fn(),
}));
// Off by default, matching the registry, so every describe below exercises the
// pre-feature behavior. The start-term describe turns it on for itself.
const mockStartTermsFlag = vi.fn().mockResolvedValue(false);
vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: (key: string) =>
    key === "start-terms" ? mockStartTermsFlag() : Promise.resolve(false),
}));
vi.mock("~/hiring/lib/email-variables", async () => {
  const actual = await vi.importActual<typeof import("~/hiring/lib/email-variables")>(
    "~/hiring/lib/email-variables",
  );
  return {
    ...actual,
    renderForSlot: vi.fn(() => ({ subject: "subj", html: "<p>hi</p>" })),
  };
});

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { enqueueOutbound } from "~/lib/outbound.server";
import { getActiveCycleById } from "~/hiring/lib/cycles";
import { action } from "~/routes/portal.apply";

const mockPrisma = prisma as unknown as {
  application: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  domainApplication: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  applicationStatusUpdate: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  cycleDomainForm: {
    findMany: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
  emailTemplate: { findUnique: ReturnType<typeof vi.fn> };
  gmailIntegration: { findFirst: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-1";
const APP_ID = "app-1";
const CYCLE_ID = "cycle-1";
const OPEN_STUDENTS_CYCLE = {
  id: CYCLE_ID,
  applicants: "Students",
  currentStatus: "Open",
  hasChallenges: true,
};
const DA_ID = "da-1";

const generalQuestions = [
  {
    key: "story",
    type: "textarea",
    required: true,
    data: { label: "Tell your story", maxWords: 5 },
  },
  {
    key: "name",
    type: "text",
    required: true,
    data: { label: "Name" },
  },
  {
    key: "no_limit_story",
    type: "textarea",
    required: false,
    data: { label: "Anything else" },
  },
];

const domainQuestions = [
  {
    key: "domain_essay",
    type: "textarea",
    required: true,
    data: { label: "Why this domain?", maxWords: 3 },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks wipes the resolved value too, so restore the default.
  mockStartTermsFlag.mockResolvedValue(false);
  (mockPrisma as any).application = {
    // The action's ownership check: the application is the caller's own.
    findFirst: vi.fn().mockResolvedValue({ id: APP_ID, applicationCycleId: CYCLE_ID }),
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn(),
    upsert: vi.fn(),
  };
  (mockPrisma as any).domainApplication = {
    findMany: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  };
  (mockPrisma as any).applicationStatusUpdate = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
  };
  (mockPrisma as any).cycleDomainForm = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).user = { findUnique: vi.fn().mockResolvedValue(null) };
  (mockPrisma as any).emailTemplate = {
    findUnique: vi.fn().mockResolvedValue(null),
  };
  (mockPrisma as any).gmailIntegration = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "applicant" },
  } as any);
  vi.mocked(getActiveCycleById).mockResolvedValue(OPEN_STUDENTS_CYCLE as any);
});

function makeSubmitRequest(overrides: {
  answers?: Record<string, string>;
  domainAnswers?: { domainApplicationId: string; answers: Record<string, string> }[];
  selectedDomainIds?: string[];
} = {}) {
  const body = new URLSearchParams({
    intent: "submit",
    applicationId: APP_ID,
    answers: JSON.stringify(overrides.answers ?? {}),
    domainAnswers: JSON.stringify(overrides.domainAnswers ?? []),
    selectedDomainIds: JSON.stringify(overrides.selectedDomainIds ?? []),
    urlQuestions: JSON.stringify([]),
  });
  return new Request("http://localhost/portal/apply", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

describe("POST /portal/apply (submit) word-count validation", () => {
  it("rejects an over-limit textarea with wordCountErrors and writes nothing", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationFormVersion: { questions: generalQuestions },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);

    const res = await action({
      request: makeSubmitRequest({
        answers: { story: "one two three four five six", name: "Ada" },
      }),
      params: {},
      context: {},
    } as any);

    expect((res as any).wordCountErrors).toBeDefined();
    expect((res as any).wordCountErrors.story).toMatchObject({
      wordCount: 6,
      maxWords: 5,
      label: "Tell your story",
    });

    expect(mockPrisma.application.update).not.toHaveBeenCalled();
    expect(mockPrisma.domainApplication.update).not.toHaveBeenCalled();
    expect(mockPrisma.domainApplication.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.applicationStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("proceeds when answers are at or under the word limit", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationFormVersion: { questions: generalQuestions },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);

    const res = await action({
      request: makeSubmitRequest({
        answers: { story: "one two three four five", name: "Ada" },
      }),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(302);
    expect(mockPrisma.application.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.applicationStatusUpdate.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.applicationStatusUpdate.create).toHaveBeenCalledWith({
      data: { applicationId: APP_ID, userId: USER_ID, newStatus: "Submitted" },
    });
  });

  it("ignores textarea questions without a maxWords limit", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationFormVersion: { questions: generalQuestions },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);

    const res = await action({
      request: makeSubmitRequest({
        answers: {
          story: "one two",
          name: "Ada",
          no_limit_story: "this is a very very very long answer with many words",
        },
      }),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(302);
    expect(mockPrisma.application.update).toHaveBeenCalledTimes(1);
  });

  it("catches over-limit answers on domain-specific questions and bails before writes", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationFormVersion: { questions: generalQuestions },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      { id: DA_ID, challengeFormVersion: { questions: domainQuestions } },
    ]);

    const res = await action({
      request: makeSubmitRequest({
        answers: { story: "fine", name: "Ada" },
        domainAnswers: [
          {
            domainApplicationId: DA_ID,
            answers: { domain_essay: "way too many words here" },
          },
        ],
      }),
      params: {},
      context: {},
    } as any);

    expect((res as any).wordCountErrors.domain_essay).toMatchObject({
      wordCount: 5,
      maxWords: 3,
      label: "Why this domain?",
    });
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
    expect(mockPrisma.domainApplication.update).not.toHaveBeenCalled();
    expect(mockPrisma.applicationStatusUpdate.create).not.toHaveBeenCalled();
  });
});

describe("POST /portal/apply (submit) required-question validation", () => {
  it("rejects submission when a selected domain has unanswered required questions", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationFormVersion: { questions: generalQuestions },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: DA_ID,
        domainId: "domain-x",
        selected: true,
        challengeFormVersion: { questions: domainQuestions },
      },
    ]);

    const res = await action({
      request: makeSubmitRequest({
        answers: { story: "fine", name: "Ada" },
        domainAnswers: [{ domainApplicationId: DA_ID, answers: {} }],
        selectedDomainIds: ["domain-x"],
      }),
      params: {},
      context: {},
    } as any);

    expect((res as any).error).toMatch(/required questions/i);
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
    expect(mockPrisma.domainApplication.update).not.toHaveBeenCalled();
    expect(mockPrisma.applicationStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("rejects submission when selected domain is omitted from domainAnswers entirely", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationFormVersion: { questions: generalQuestions },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: DA_ID,
        domainId: "domain-x",
        selected: true,
        challengeFormVersion: { questions: domainQuestions },
      },
    ]);

    const res = await action({
      request: makeSubmitRequest({
        answers: { story: "fine", name: "Ada" },
        domainAnswers: [],
        selectedDomainIds: ["domain-x"],
      }),
      params: {},
      context: {},
    } as any);

    expect((res as any).error).toMatch(/required questions/i);
    expect(mockPrisma.applicationStatusUpdate.create).not.toHaveBeenCalled();
  });
});

// ─── create-draft / update-domains (multi-challenge support) ────────────────

const GENERAL_FV_ID = "general-fv";
const DOMAIN_A = "domain-a";
const DOMAIN_B = "domain-b";
// Form IDs for per-domain challenge forms
const FORM_A = "form-a";
const FORM_B = "form-b";
// FormVersion IDs resolved from those forms
const FV_A1 = "fv-a1";
const FV_A2 = "fv-a2";
const FV_B1 = "fv-b1";
// Opaque picker ids sent by the client (matching the "form:<formId>" convention)
const CV_A1 = `form:${FORM_A}`;
const CV_A2 = `form:form-a2`; // second form for domain A
const CV_B1 = `form:${FORM_B}`;

function makeCreateDraftRequest(selectedDomains: { domainId: string; challengeVersionId: string }[]) {
  const body = new URLSearchParams({
    intent: "create-draft",
    cycleId: CYCLE_ID,
    applicationFormVersionId: GENERAL_FV_ID,
    selectedDomains: JSON.stringify(selectedDomains),
  });
  return new Request("http://localhost/portal/apply", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

function makeUpdateDomainsRequest(
  applicationId: string,
  selectedDomains: { domainId: string; challengeVersionId: string }[],
) {
  const body = new URLSearchParams({
    intent: "update-domains",
    applicationId,
    cycleId: CYCLE_ID,
    selectedDomains: JSON.stringify(selectedDomains),
  });
  return new Request("http://localhost/portal/apply", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

describe("POST /portal/apply (submit) confirmation email", () => {
  const CYCLE_ID = "cycle-1";

  function mockApplicantsAndGmail() {
    vi.mocked(enqueueOutbound).mockResolvedValue({ id: "om-x", deduped: false });
    (mockPrisma as any).user.findUnique.mockResolvedValueOnce({
      id: USER_ID,
      firstName: "Ada",
      dartmouthEmail: "ada@dartmouth.edu",
      daliEmail: null,
    });
  }

  it("sends a confirmation email on first submission when the shared email exists", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      applicationFormVersion: { questions: [] },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);
    mockPrisma.applicationStatusUpdate.findFirst.mockResolvedValue(null);
    mockApplicantsAndGmail();
    (mockPrisma as any).emailTemplate.findUnique.mockResolvedValue({ subject: "s", body: "b" });

    const res = await action({
      request: makeSubmitRequest({ answers: {} }),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(302);
    expect(mockPrisma.emailTemplate.findUnique).toHaveBeenCalledWith({
      where: { key: "hiring:notification:ApplicationReceived" },
    });
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(enqueueOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", target: "ada@dartmouth.edu" }),
    );
  });

  it("does not send on resubmit (existing Submitted status update)", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      applicationFormVersion: { questions: [] },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);
    mockPrisma.applicationStatusUpdate.findFirst.mockResolvedValue({
      newStatus: "Submitted",
    });

    const res = await action({
      request: makeSubmitRequest({ answers: {} }),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(302);
    expect(mockPrisma.applicationStatusUpdate.create).not.toHaveBeenCalled();
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("submits successfully when no ApplicationReceived binding is set", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      applicationFormVersion: { questions: [] },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);
    mockPrisma.applicationStatusUpdate.findFirst.mockResolvedValue(null);
    mockApplicantsAndGmail();
    (mockPrisma as any).emailTemplate.findUnique.mockResolvedValue(null);

    const res = await action({
      request: makeSubmitRequest({ answers: {} }),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(302);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("does not block the redirect when the confirmation enqueue throws", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      applicationFormVersion: { questions: [] },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);
    mockPrisma.applicationStatusUpdate.findFirst.mockResolvedValue(null);
    mockApplicantsAndGmail();
    (mockPrisma as any).emailTemplate.findUnique.mockResolvedValue({ subject: "s", body: "b" });
    vi.mocked(enqueueOutbound).mockRejectedValueOnce(new Error("Gmail send failed: 401"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await action({
      request: makeSubmitRequest({ answers: {} }),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(302);
    expect(mockPrisma.applicationStatusUpdate.create).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

describe("POST /portal/apply (create-draft) — multi-challenge", () => {
  it("creates one DomainApplication per (domain, picked CV) pair", async () => {
    mockPrisma.cycleDomainForm.findMany.mockResolvedValue([
      { domainId: DOMAIN_A, formId: FORM_A, form: { versions: [{ id: FV_A1 }] } },
      { domainId: DOMAIN_A, formId: "form-a2", form: { versions: [{ id: FV_A2 }] } },
      { domainId: DOMAIN_B, formId: FORM_B, form: { versions: [{ id: FV_B1 }] } },
    ]);
    mockPrisma.application.upsert.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [
        { id: "da-1", domainId: DOMAIN_A, challengeFormVersion: { formId: FORM_A }, answers: {} },
        { id: "da-2", domainId: DOMAIN_B, challengeFormVersion: { formId: FORM_B }, answers: {} },
      ],
    });

    await action({
      request: makeCreateDraftRequest([
        { domainId: DOMAIN_A, challengeVersionId: CV_A2 },
        { domainId: DOMAIN_B, challengeVersionId: CV_B1 },
      ]),
      params: {},
      context: {},
    } as any);

    expect(mockPrisma.application.upsert).toHaveBeenCalledTimes(1);
    const callArg = mockPrisma.application.upsert.mock.calls[0][0];
    expect(callArg.create.domainApplications.create).toEqual([
      { domainId: DOMAIN_A, challengeFormVersionId: FV_A2, answers: {} },
      { domainId: DOMAIN_B, challengeFormVersionId: FV_B1, answers: {} },
    ]);
  });

  it("drops selections whose CV is not linked to the cycle", async () => {
    mockPrisma.cycleDomainForm.findMany.mockResolvedValue([
      { domainId: DOMAIN_A, formId: FORM_A, form: { versions: [{ id: FV_A1 }] } },
      // DOMAIN_B has no entry — CV_B1 should be dropped
    ]);
    mockPrisma.application.upsert.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [
        { id: "da-1", domainId: DOMAIN_A, challengeFormVersion: { formId: FORM_A }, answers: {} },
      ],
    });

    await action({
      request: makeCreateDraftRequest([
        { domainId: DOMAIN_A, challengeVersionId: CV_A1 },
        // CV_B1 isn't linked to this cycle — should be silently dropped
        { domainId: DOMAIN_B, challengeVersionId: CV_B1 },
      ]),
      params: {},
      context: {},
    } as any);

    const callArg = mockPrisma.application.upsert.mock.calls[0][0];
    expect(callArg.create.domainApplications.create).toEqual([
      { domainId: DOMAIN_A, challengeFormVersionId: FV_A1, answers: {} },
    ]);
  });

  it("drops selections whose CV does not match the claimed domain", async () => {
    mockPrisma.cycleDomainForm.findMany.mockResolvedValue([
      { domainId: DOMAIN_A, formId: FORM_A, form: { versions: [{ id: FV_A1 }] } },
      { domainId: DOMAIN_B, formId: FORM_B, form: { versions: [{ id: FV_B1 }] } },
    ]);
    mockPrisma.application.upsert.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [],
    });

    await action({
      request: makeCreateDraftRequest([
        // Form-tampering: claim domain A but pass CV_B1 (which belongs to B)
        { domainId: DOMAIN_A, challengeVersionId: CV_B1 },
      ]),
      params: {},
      context: {},
    } as any);

    const callArg = mockPrisma.application.upsert.mock.calls[0][0];
    expect(callArg.create.domainApplications.create).toEqual([]);
  });
});

describe("POST /portal/apply (update-domains) — multi-challenge", () => {
  it("creates a new DomainApplication for a newly selected domain", async () => {
    mockPrisma.cycleDomainForm.findMany.mockResolvedValue([
      { domainId: DOMAIN_A, formId: FORM_A, form: { versions: [{ id: FV_A1 }] } },
      { domainId: DOMAIN_B, formId: FORM_B, form: { versions: [{ id: FV_B1 }] } },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      // Existing: domain A only
      {
        id: "da-1",
        applicationId: APP_ID,
        domainId: DOMAIN_A,
        challengeFormVersionId: FV_A1,
        selected: true,
      },
    ]);
    mockPrisma.application.findUnique.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [],
    });

    await action({
      request: makeUpdateDomainsRequest(APP_ID, [
        { domainId: DOMAIN_A, challengeVersionId: CV_A1 },
        { domainId: DOMAIN_B, challengeVersionId: CV_B1 },
      ]),
      params: {},
      context: {},
    } as any);

    expect(mockPrisma.domainApplication.create).toHaveBeenCalledWith({
      data: { applicationId: APP_ID, domainId: DOMAIN_B, challengeFormVersionId: FV_B1, answers: {} },
    });
  });

  it("clears answers when the applicant switches the picked challenge for a domain", async () => {
    mockPrisma.cycleDomainForm.findMany.mockResolvedValue([
      { domainId: DOMAIN_A, formId: FORM_A, form: { versions: [{ id: FV_A1 }] } },
      { domainId: DOMAIN_A, formId: "form-a2", form: { versions: [{ id: FV_A2 }] } },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: "da-1",
        applicationId: APP_ID,
        domainId: DOMAIN_A,
        challengeFormVersionId: FV_A1,
        selected: true,
      },
    ]);
    mockPrisma.application.findUnique.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [],
    });

    await action({
      request: makeUpdateDomainsRequest(APP_ID, [
        { domainId: DOMAIN_A, challengeVersionId: CV_A2 },
      ]),
      params: {},
      context: {},
    } as any);

    expect(mockPrisma.domainApplication.update).toHaveBeenCalledWith({
      where: { id: "da-1" },
      data: { challengeFormVersionId: FV_A2, answers: {} },
    });
  });

  it("preserves answers when domain is re-selected with the same CV (selected: true only)", async () => {
    mockPrisma.cycleDomainForm.findMany.mockResolvedValue([
      { domainId: DOMAIN_A, formId: FORM_A, form: { versions: [{ id: FV_A1 }] } },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: "da-1",
        applicationId: APP_ID,
        domainId: DOMAIN_A,
        challengeFormVersionId: FV_A1,
        selected: false,
      },
    ]);
    mockPrisma.application.findUnique.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [],
    });

    await action({
      request: makeUpdateDomainsRequest(APP_ID, [
        { domainId: DOMAIN_A, challengeVersionId: CV_A1 },
      ]),
      params: {},
      context: {},
    } as any);

    expect(mockPrisma.domainApplication.update).toHaveBeenCalledWith({
      where: { id: "da-1" },
      data: { selected: true },
    });
  });

  it("marks deselected domains as not selected (preserves the row for answer recovery)", async () => {
    mockPrisma.cycleDomainForm.findMany.mockResolvedValue([
      { domainId: DOMAIN_A, formId: FORM_A, form: { versions: [{ id: FV_A1 }] } },
      { domainId: DOMAIN_B, formId: FORM_B, form: { versions: [{ id: FV_B1 }] } },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: "da-1",
        applicationId: APP_ID,
        domainId: DOMAIN_A,
        challengeFormVersionId: FV_A1,
        selected: true,
      },
      {
        id: "da-2",
        applicationId: APP_ID,
        domainId: DOMAIN_B,
        challengeFormVersionId: FV_B1,
        selected: true,
      },
    ]);
    mockPrisma.application.findUnique.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [],
    });

    await action({
      request: makeUpdateDomainsRequest(APP_ID, [
        { domainId: DOMAIN_A, challengeVersionId: CV_A1 },
      ]),
      params: {},
      context: {},
    } as any);

    expect(mockPrisma.domainApplication.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["da-2"] } },
      data: { selected: false },
    });
  });
});

describe("POST /portal/apply — open Students cycle guard", () => {
  it("rejects a write to an application that isn't the caller's", async () => {
    mockPrisma.application.findFirst.mockResolvedValue(null);

    const res: any = await action({ request: makeSubmitRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(409);
    expect(mockPrisma.application.findFirst.mock.calls[0][0].where).toEqual({
      id: APP_ID,
      userId: USER_ID,
    });
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
  });

  it("rejects a draft on a cycle that isn't an Open Students cycle", async () => {
    vi.mocked(getActiveCycleById).mockResolvedValue({
      ...OPEN_STUDENTS_CYCLE,
      applicants: "Interns",
    } as any);

    const res: any = await action({
      request: makeCreateDraftRequest([{ domainId: DOMAIN_A, challengeVersionId: `form:${FORM_A}` }]),
      params: {},
      context: {},
    } as any);
    expect(res.status).toBe(409);
    expect(mockPrisma.application.upsert).not.toHaveBeenCalled();
  });

  it("rejects writes once the cycle has closed", async () => {
    vi.mocked(getActiveCycleById).mockResolvedValue({
      ...OPEN_STUDENTS_CYCLE,
      currentStatus: "UnderReview",
    } as any);

    const res: any = await action({ request: makeSubmitRequest(), params: {}, context: {} } as any);
    expect(res.status).toBe(409);
  });
});

describe("POST /portal/apply (create-draft) — cycle without challenges", () => {
  it("creates a DomainApplication per selected cycle domain with no challenge pinned", async () => {
    vi.mocked(getActiveCycleById).mockResolvedValue({
      ...OPEN_STUDENTS_CYCLE,
      hasChallenges: false,
    } as any);
    (mockPrisma as any).domainApplicationCycle = {
      findMany: vi.fn().mockResolvedValue([{ domainId: DOMAIN_A }, { domainId: DOMAIN_B }]),
    };
    mockPrisma.application.upsert.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [],
    });

    await action({
      request: makeCreateDraftRequest([
        { domainId: DOMAIN_A, challengeVersionId: "" },
        { domainId: "not-in-cycle", challengeVersionId: "" },
      ]),
      params: {},
      context: {},
    } as any);

    const created = mockPrisma.application.upsert.mock.calls[0][0].create.domainApplications.create;
    expect(created).toEqual([{ domainId: DOMAIN_A, answers: {} }]);
  });
});

// The start term is a first-class field, not a form answer: the choices are
// per-cycle config and the answers blob is the frozen record of submission. The
// server re-validates the pick against what the cycle offers, since the client
// gate is only as trustworthy as the body it posts.
describe("POST /portal/apply — start term", () => {
  const T_26S = "t-26s";
  const T_26F = "t-26f";
  const CHOICE_CYCLE = {
    ...OPEN_STUDENTS_CYCLE,
    hasChallenges: false,
    startTermIds: [T_26S, T_26F],
  };

  function submitWith(startTermId?: string) {
    const body: Record<string, string> = {
      intent: "submit",
      applicationId: APP_ID,
      answers: JSON.stringify({}),
      domainAnswers: JSON.stringify([]),
      selectedDomainIds: JSON.stringify([]),
      urlQuestions: JSON.stringify([]),
    };
    if (startTermId !== undefined) body.startTermId = startTermId;
    return new Request("http://localhost/portal/apply", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  }

  function saveDraftWith(startTermId?: string) {
    const body: Record<string, string> = {
      intent: "save-draft",
      applicationId: APP_ID,
      answers: JSON.stringify({}),
      domainAnswers: JSON.stringify([]),
    };
    if (startTermId !== undefined) body.startTermId = startTermId;
    return new Request("http://localhost/portal/apply", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  }

  const lastUpdateData = () =>
    mockPrisma.application.update.mock.calls.at(-1)?.[0]?.data;

  beforeEach(() => {
    mockStartTermsFlag.mockResolvedValue(true);
    vi.mocked(getActiveCycleById).mockResolvedValue(CHOICE_CYCLE as any);
    // No questions to answer, so the start term is the only submit gate.
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      applicationFormVersion: { questions: [] },
      startTermId: null,
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);
  });

  it("stores a pick the cycle offers", async () => {
    await action({ request: submitWith(T_26F), params: {}, context: {} } as any);
    expect(lastUpdateData()).toMatchObject({ startTermId: T_26F });
  });

  it("refuses a term the cycle does not offer", async () => {
    const res: any = await action({
      request: submitWith("t-28w"),
      params: {},
      context: {},
    } as any);
    expect(res.error).toMatch(/term you'd start in/i);
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
  });

  it("refuses a submit with no pick at all", async () => {
    const res: any = await action({
      request: submitWith(""),
      params: {},
      context: {},
    } as any);
    expect(res.error).toMatch(/term you'd start in/i);
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
  });

  it("keeps the stored pick when the field is absent from a resubmit", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      applicationFormVersion: { questions: [] },
      startTermId: T_26S,
    });
    await action({ request: submitWith(), params: {}, context: {} } as any);
    expect(lastUpdateData()).toMatchObject({ startTermId: T_26S });
  });

  it("saves a pick from a draft autosave", async () => {
    await action({ request: saveDraftWith(T_26S), params: {}, context: {} } as any);
    expect(lastUpdateData()).toMatchObject({ startTermId: T_26S });
  });

  it("clears the pick when a draft autosave posts an empty one", async () => {
    await action({ request: saveDraftWith(""), params: {}, context: {} } as any);
    expect(lastUpdateData()).toMatchObject({ startTermId: null });
  });

  it("ignores an off-menu pick on autosave rather than storing it", async () => {
    await action({ request: saveDraftWith("t-28w"), params: {}, context: {} } as any);
    expect(lastUpdateData()).not.toHaveProperty("startTermId");
  });

  it("records the only offered term at draft creation without asking", async () => {
    vi.mocked(getActiveCycleById).mockResolvedValue({
      ...OPEN_STUDENTS_CYCLE,
      hasChallenges: false,
      startTermIds: [T_26F],
    } as any);
    mockPrisma.application.upsert.mockResolvedValue({ id: APP_ID, domainApplications: [] });
    mockPrisma.application.findFirst.mockResolvedValue(null);

    await action({
      request: new Request("http://localhost/portal/apply", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          intent: "create-draft",
          selectedDomains: JSON.stringify([]),
        }).toString(),
      }),
      params: {},
      context: {},
    } as any);

    expect(mockPrisma.application.upsert.mock.calls[0][0].create.startTermId).toBe(T_26F);
  });

  it("writes no start term at all while the flag is off", async () => {
    mockStartTermsFlag.mockResolvedValue(false);
    await action({ request: submitWith(T_26F), params: {}, context: {} } as any);
    expect(lastUpdateData()).not.toHaveProperty("startTermId");
  });
});

describe("POST /portal/apply — reused waitlisted application", () => {
  const continuedInterestQuestions = [
    { key: "still_interested", type: "textarea", required: true, data: { label: "Why still?" } },
  ];
  // A DA reusing a waitlisted application: its challenge answers are a frozen
  // copy, and the continued interest form is what the applicant fills in.
  const continuedDa = {
    id: DA_ID,
    domainId: DOMAIN_A,
    selected: true,
    continuedFromId: "da-waitlisted",
    challengeFormVersionId: "fv-old-cycle",
    challengeFormVersion: { questions: domainQuestions },
    continuedInterestFormVersion: { questions: continuedInterestQuestions },
  };

  beforeEach(() => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      applicationFormVersion: { questions: generalQuestions },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([continuedDa]);
  });

  it("requires the continued interest form, not the frozen application", async () => {
    const res = await action({
      request: makeSubmitRequest({
        domainAnswers: [{ domainApplicationId: DA_ID, answers: {} }],
        selectedDomainIds: [DOMAIN_A],
      }),
      params: {},
      context: {},
    } as any);

    expect((res as any).error).toMatch(/\(1 unanswered\)/);
  });

  it("saves continued interest answers and never overwrites the frozen ones", async () => {
    mockPrisma.applicationStatusUpdate.findFirst.mockResolvedValue({ id: "already-submitted" });

    await action({
      request: makeSubmitRequest({
        answers: { story: "tampered" },
        domainAnswers: [
          {
            domainApplicationId: DA_ID,
            answers: { domain_essay: "tampered" },
            continuedInterestAnswers: { still_interested: "Yes" },
          } as any,
        ],
        selectedDomainIds: [DOMAIN_A],
      }),
      params: {},
      context: {},
    } as any);

    expect(mockPrisma.application.update.mock.calls[0][0].data).not.toHaveProperty("answers");
    expect(mockPrisma.domainApplication.updateMany).toHaveBeenCalledWith({
      where: { id: DA_ID, applicationId: APP_ID },
      data: { continuedInterestAnswers: { still_interested: "Yes" } },
    });
  });

  it("keeps the pinned challenge when domains change", async () => {
    mockPrisma.cycleDomainForm.findMany.mockResolvedValue([
      { domainId: DOMAIN_A, formId: FORM_A, form: { versions: [{ id: FV_A1 }] } },
    ]);
    mockPrisma.application.findUnique.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [],
    });

    await action({
      request: makeUpdateDomainsRequest(APP_ID, [
        { domainId: DOMAIN_A, challengeVersionId: CV_A1 },
      ]),
      params: {},
      context: {},
    } as any);

    expect(mockPrisma.domainApplication.update).not.toHaveBeenCalled();
  });
});
