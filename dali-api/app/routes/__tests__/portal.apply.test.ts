import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth");
vi.mock("~/lib/cycles");
vi.mock("~/lib/submission-check", () => ({
  checkGitHubUrl: vi.fn(),
  checkFigmaUrl: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { action } from "~/routes/portal.apply";

const mockPrisma = prisma as unknown as {
  application: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  domainApplication: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  applicationStatusUpdate: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
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
  };
  (mockPrisma as any).domainApplication = {
    findMany: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
  };
  (mockPrisma as any).applicationStatusUpdate = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
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
