import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/hiring/lib/cycles");
vi.mock("~/hiring/lib/submission-check", () => ({
  checkGitHubUrl: vi.fn(),
  checkFigmaUrl: vi.fn(),
}));
vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn() }));
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
import { sendEmail } from "~/lib/gmail";
import { action } from "~/routes/portal.apply";

const mockPrisma = prisma as unknown as {
  application: {
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
  challengeVersionApplicationCycle: {
    findMany: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
  cycleNotificationEmail: { findUnique: ReturnType<typeof vi.fn> };
  gmailIntegration: { findFirst: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-1";
const APP_ID = "app-1";
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
  (mockPrisma as any).application = {
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
  (mockPrisma as any).challengeVersionApplicationCycle = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).user = { findUnique: vi.fn().mockResolvedValue(null) };
  (mockPrisma as any).cycleNotificationEmail = {
    findUnique: vi.fn().mockResolvedValue(null),
  };
  (mockPrisma as any).gmailIntegration = {
    findFirst: vi.fn().mockResolvedValue(null),
  };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "applicant" },
  } as any);
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
      generalChallengeVersion: { questions: generalQuestions },
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
      generalChallengeVersion: { questions: generalQuestions },
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
      generalChallengeVersion: { questions: generalQuestions },
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
      generalChallengeVersion: { questions: generalQuestions },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      { id: DA_ID, challengeVersion: { questions: domainQuestions } },
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
      generalChallengeVersion: { questions: generalQuestions },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: DA_ID,
        selected: true,
        challengeVersion: { domainId: "domain-x", questions: domainQuestions },
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
      generalChallengeVersion: { questions: generalQuestions },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: DA_ID,
        selected: true,
        challengeVersion: { domainId: "domain-x", questions: domainQuestions },
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

const CYCLE_ID = "cycle-1";
const GENERAL_CV_ID = "general-cv";
const DOMAIN_A = "domain-a";
const DOMAIN_B = "domain-b";
const CV_A1 = "cv-a-1";
const CV_A2 = "cv-a-2";
const CV_B1 = "cv-b-1";

function makeCreateDraftRequest(selectedDomains: { domainId: string; challengeVersionId: string }[]) {
  const body = new URLSearchParams({
    intent: "create-draft",
    cycleId: CYCLE_ID,
    generalChallengeVersionId: GENERAL_CV_ID,
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
    (mockPrisma as any).gmailIntegration.findFirst.mockResolvedValue({ oauthTokens: "rt" });
    (mockPrisma as any).user.findUnique.mockResolvedValueOnce({
      id: USER_ID,
      firstName: "Ada",
      dartmouthEmail: "ada@dartmouth.edu",
      daliEmail: null,
    });
  }

  it("sends a confirmation email on first submission when a binding exists", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      generalChallengeVersion: { questions: [] },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);
    mockPrisma.applicationStatusUpdate.findFirst.mockResolvedValue(null);
    mockApplicantsAndGmail();
    (mockPrisma as any).cycleNotificationEmail.findUnique.mockResolvedValue({
      emailTemplateVersion: { subject: "s", body: "b" },
    });

    const res = await action({
      request: makeSubmitRequest({ answers: {} }),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(302);
    expect(mockPrisma.cycleNotificationEmail.findUnique).toHaveBeenCalledWith({
      where: {
        applicationCycleId_notificationType: {
          applicationCycleId: CYCLE_ID,
          notificationType: "ApplicationReceived",
        },
      },
      include: { emailTemplateVersion: true },
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "rt", to: "ada@dartmouth.edu" }),
    );
  });

  it("does not send on resubmit (existing Submitted status update)", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      generalChallengeVersion: { questions: [] },
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
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("submits successfully when no ApplicationReceived binding is set", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      generalChallengeVersion: { questions: [] },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);
    mockPrisma.applicationStatusUpdate.findFirst.mockResolvedValue(null);
    mockApplicantsAndGmail();
    (mockPrisma as any).cycleNotificationEmail.findUnique.mockResolvedValue(null);

    const res = await action({
      request: makeSubmitRequest({ answers: {} }),
      params: {},
      context: {},
    } as any);

    expect((res as Response).status).toBe(302);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not block the redirect when sendEmail throws", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      applicationCycleId: CYCLE_ID,
      generalChallengeVersion: { questions: [] },
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue([]);
    mockPrisma.applicationStatusUpdate.findFirst.mockResolvedValue(null);
    mockApplicantsAndGmail();
    (mockPrisma as any).cycleNotificationEmail.findUnique.mockResolvedValue({
      emailTemplateVersion: { subject: "s", body: "b" },
    });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("Gmail send failed: 401"));
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
    mockPrisma.challengeVersionApplicationCycle.findMany.mockResolvedValue([
      { challengeVersionId: CV_A1, challengeVersion: { domainId: DOMAIN_A } },
      { challengeVersionId: CV_A2, challengeVersion: { domainId: DOMAIN_A } },
      { challengeVersionId: CV_B1, challengeVersion: { domainId: DOMAIN_B } },
    ]);
    mockPrisma.application.upsert.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [
        { id: "da-1", challengeVersionId: CV_A2, challengeVersion: { domainId: DOMAIN_A }, answers: {} },
        { id: "da-2", challengeVersionId: CV_B1, challengeVersion: { domainId: DOMAIN_B }, answers: {} },
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
      { challengeVersionId: CV_A2, answers: {} },
      { challengeVersionId: CV_B1, answers: {} },
    ]);
  });

  it("drops selections whose CV is not linked to the cycle", async () => {
    mockPrisma.challengeVersionApplicationCycle.findMany.mockResolvedValue([
      { challengeVersionId: CV_A1, challengeVersion: { domainId: DOMAIN_A } },
    ]);
    mockPrisma.application.upsert.mockResolvedValue({
      id: APP_ID,
      answers: {},
      domainApplications: [
        { id: "da-1", challengeVersionId: CV_A1, challengeVersion: { domainId: DOMAIN_A }, answers: {} },
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
      { challengeVersionId: CV_A1, answers: {} },
    ]);
  });

  it("drops selections whose CV does not match the claimed domain", async () => {
    mockPrisma.challengeVersionApplicationCycle.findMany.mockResolvedValue([
      { challengeVersionId: CV_A1, challengeVersion: { domainId: DOMAIN_A } },
      { challengeVersionId: CV_B1, challengeVersion: { domainId: DOMAIN_B } },
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
    mockPrisma.challengeVersionApplicationCycle.findMany.mockResolvedValue([
      { challengeVersionId: CV_A1, challengeVersion: { domainId: DOMAIN_A } },
      { challengeVersionId: CV_B1, challengeVersion: { domainId: DOMAIN_B } },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      // Existing: domain A only
      {
        id: "da-1",
        applicationId: APP_ID,
        challengeVersionId: CV_A1,
        challengeVersion: { domainId: DOMAIN_A },
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
      data: { applicationId: APP_ID, challengeVersionId: CV_B1, answers: {} },
    });
  });

  it("clears answers when the applicant switches the picked challenge for a domain", async () => {
    mockPrisma.challengeVersionApplicationCycle.findMany.mockResolvedValue([
      { challengeVersionId: CV_A1, challengeVersion: { domainId: DOMAIN_A } },
      { challengeVersionId: CV_A2, challengeVersion: { domainId: DOMAIN_A } },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: "da-1",
        applicationId: APP_ID,
        challengeVersionId: CV_A1,
        challengeVersion: { domainId: DOMAIN_A },
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
      data: { challengeVersionId: CV_A2, answers: {} },
    });
  });

  it("preserves answers when domain is re-selected with the same CV (selected: true only)", async () => {
    mockPrisma.challengeVersionApplicationCycle.findMany.mockResolvedValue([
      { challengeVersionId: CV_A1, challengeVersion: { domainId: DOMAIN_A } },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: "da-1",
        applicationId: APP_ID,
        challengeVersionId: CV_A1,
        challengeVersion: { domainId: DOMAIN_A },
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
    mockPrisma.challengeVersionApplicationCycle.findMany.mockResolvedValue([
      { challengeVersionId: CV_A1, challengeVersion: { domainId: DOMAIN_A } },
      { challengeVersionId: CV_B1, challengeVersion: { domainId: DOMAIN_B } },
    ]);
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      {
        id: "da-1",
        applicationId: APP_ID,
        challengeVersionId: CV_A1,
        challengeVersion: { domainId: DOMAIN_A },
        selected: true,
      },
      {
        id: "da-2",
        applicationId: APP_ID,
        challengeVersionId: CV_B1,
        challengeVersion: { domainId: DOMAIN_B },
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
