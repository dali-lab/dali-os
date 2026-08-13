import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  requireCore: vi.fn(),
  requireCoreOrDomainLead: vi.fn(),
  requireMemberSession: vi.fn(),
  forbidden: vi.fn((_req: Request) =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
  ),
  unauthorized: vi.fn((_req: Request) =>
    Response.json({ error: "Unauthorized" }, { status: 401 }),
  ),
  redirectApplicantToPortal: vi.fn(() => null),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), getUserRoles: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({
  notify: vi.fn(),
  renderNotificationEmail: vi.fn(() => "<p>email</p>"),
}));
vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/gmail-integration", () => ({
  getSender: vi.fn().mockResolvedValue({
    id: "g-1",
    refreshToken: "rt",
    sendAsEmail: "applications@dali.dartmouth.edu",
  }),
  noteSenderHealth: vi.fn(),
}));
vi.mock("~/lib/app-env", () => ({
  getFrontendUrl: vi.fn(() => "http://localhost"),
  getAppEnv: vi.fn(() => "prod"),
}));
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn(() => true),
  sendDm: vi.fn().mockResolvedValue({ ts: "1.0" }),
}));
vi.mock("~/lib/photo", () => ({
  resolvePhotoUrl: vi.fn(async (url: string | null | undefined) => url ?? null),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, getUserRoles } from "~/lib/roles";
import { notify } from "~/lib/notify.server";
import { sendEmail } from "~/lib/gmail";
import { sendDm } from "~/slack/lib/slack-client";
import { loader, action } from "~/hiring/routes/onboarding";

const mockPrisma = prisma as unknown as Record<string, any>;
const CORE_ID = "core-1";

function decisionRow(over: {
  userId: string;
  first: string;
  domainCode: string;
  domainName: string;
  cycleId?: string;
  cycleName?: string;
  photoUrl?: string | null;
  daliEmail?: string | null;
  slackUserId?: string | null;
  figmaInvitedAt?: Date | null;
  onboardedAt?: Date | null;
}) {
  const cycleId = over.cycleId ?? "cyc-new";
  const cycleName = over.cycleName ?? "Spring 2026";
  return {
    id: `dec-${over.userId}-${over.domainCode}-${cycleId}`,
    createdAt: new Date("2026-05-01"),
    domainApplication: {
      domain: { displayName: over.domainName, name: over.domainName, code: over.domainCode },
      application: {
        applicationCycleId: cycleId,
        applicationCycle: { id: cycleId, name: cycleName },
        user: {
          id: over.userId,
          firstName: over.first,
          lastName: "Test",
          photoUrl: over.photoUrl ?? null,
          daliEmail: over.daliEmail ?? null,
          slackUserId: over.slackUserId ?? null,
          figmaInvitedAt: over.figmaInvitedAt ?? null,
          daliMember: { onboardedAt: over.onboardedAt ?? null },
        },
      },
    },
  };
}

function call(url = "http://localhost/hiring/onboarding") {
  return loader({ request: new Request(url), params: {}, context: {} } as any);
}

const CORE_ROLES = {
  isLabMember: true,
  isCore: true,
  isAdmin: false,
  isDomainLead: false,
  isInstructor: false,
  isInterviewer: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.applicationCycle = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.decision = { findMany: vi.fn().mockResolvedValue([]) };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: CORE_ID, type: "member" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(getUserRoles).mockResolvedValue(CORE_ROLES as any);
  vi.mocked(notify).mockResolvedValue(undefined as any);
});

describe("hiring/onboarding loader", () => {
  it("redirects non-core users home", async () => {
    vi.mocked(getUserRoles).mockResolvedValueOnce({ ...CORE_ROLES, isCore: false } as any);
    const res = (await call()) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("returns no selected cycle when none exist", async () => {
    const data = (await call()) as any;
    expect(data.selectedCycleId).toBeNull();
    expect(data.rows).toEqual([]);
    expect(mockPrisma.decision.findMany).not.toHaveBeenCalled();
  });

  it("defaults to the newest cycle and derives live status per accepted applicant", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
      { id: "cyc-old", name: "Fall 2025", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      decisionRow({
        userId: "u1",
        first: "Ada",
        domainCode: "fullstack",
        domainName: "Fullstack",
        daliEmail: "ada@dali.dartmouth.edu",
        slackUserId: "U1",
        figmaInvitedAt: new Date(),
        onboardedAt: null,
      }),
      decisionRow({
        userId: "u2",
        first: "Bea",
        domainCode: "design",
        domainName: "Design",
        daliEmail: null,
        slackUserId: null,
        figmaInvitedAt: null,
        onboardedAt: null,
      }),
    ]);

    const data = (await call()) as any;

    expect(data.selectedCycleId).toBe("cyc-new");
    expect(data.allCycles).toBe(false);
    expect(mockPrisma.decision.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrisma.decision.findMany.mock.calls[0][0].where;
    expect(where.stage).toBe("Released");
    expect(where.type).toBe("Accepted");
    expect(where.domainApplication.application.applicationCycleId).toBe("cyc-new");

    expect(data.rows).toEqual([
      {
        userId: "u1",
        name: "Ada Test",
        photoUrl: null,
        domainKey: "fullstack",
        role: "Fullstack",
        cycleId: "cyc-new",
        cycleName: "Spring 2026",
        daliEmail: "ada@dali.dartmouth.edu",
        emailCreated: true,
        inSlack: true,
        figmaInvited: true,
        profileSubmitted: false,
      },
      {
        userId: "u2",
        name: "Bea Test",
        photoUrl: null,
        domainKey: "design",
        role: "Design",
        cycleId: "cyc-new",
        cycleName: "Spring 2026",
        daliEmail: null,
        emailCreated: false,
        inSlack: false,
        figmaInvited: false,
        profileSubmitted: false,
      },
    ]);

    expect(data.domains).toEqual([
      { key: "design", label: "Design" },
      { key: "fullstack", label: "Fullstack" },
    ]);
    expect(data.selectedDomain).toBeNull();
  });

  it("honors a valid ?cycle= override", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
      { id: "cyc-old", name: "Fall 2025", cycleType: "Standard" },
    ]);
    const data = (await call("http://localhost/hiring/onboarding?cycle=cyc-old")) as any;
    expect(data.selectedCycleId).toBe("cyc-old");
  });

  it("falls back to the newest cycle when ?cycle= is unknown", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    const data = (await call("http://localhost/hiring/onboarding?cycle=bogus")) as any;
    expect(data.selectedCycleId).toBe("cyc-new");
  });

  it("loads all cycles when ?cycle=all", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
      { id: "cyc-old", name: "Fall 2025", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      decisionRow({
        userId: "u1",
        first: "Ada",
        domainCode: "fullstack",
        domainName: "Fullstack",
        cycleId: "cyc-new",
        cycleName: "Spring 2026",
      }),
      decisionRow({
        userId: "u2",
        first: "Bea",
        domainCode: "design",
        domainName: "Design",
        cycleId: "cyc-old",
        cycleName: "Fall 2025",
      }),
    ]);

    const data = (await call("http://localhost/hiring/onboarding?cycle=all")) as any;
    expect(data.selectedCycleId).toBe("all");
    expect(data.allCycles).toBe(true);
    const where = mockPrisma.decision.findMany.mock.calls[0][0].where;
    expect(where.domainApplication.application).toEqual({});
    expect(data.rows).toHaveLength(2);
    expect(data.rows.map((r: any) => r.cycleName).sort()).toEqual([
      "Fall 2025",
      "Spring 2026",
    ]);
  });

  it("collapses duplicate accepted decisions for the same user+domain+cycle to one row", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      decisionRow({
        userId: "u1",
        first: "Ada",
        domainCode: "fullstack",
        domainName: "Fullstack",
        daliEmail: "ada@dali.dartmouth.edu",
      }),
      decisionRow({
        userId: "u1",
        first: "Ada",
        domainCode: "fullstack",
        domainName: "Fullstack",
        daliEmail: "ada@dali.dartmouth.edu",
      }),
      decisionRow({ userId: "u1", first: "Ada", domainCode: "design", domainName: "Design" }),
    ]);

    const data = (await call()) as any;
    expect(data.rows).toHaveLength(2);
    expect(data.rows.map((r: any) => r.role)).toEqual(["Fullstack", "Design"]);
  });

  it("includes already-onboarded members (full accepted roster)", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      decisionRow({
        userId: "u1",
        first: "Ada",
        domainCode: "fullstack",
        domainName: "Fullstack",
        daliEmail: "ada@dali.dartmouth.edu",
        slackUserId: "U1",
        onboardedAt: new Date(),
      }),
      decisionRow({
        userId: "u2",
        first: "Bea",
        domainCode: "design",
        domainName: "Design",
        onboardedAt: null,
      }),
    ]);

    const data = (await call()) as any;
    expect(data.rows.map((r: any) => r.userId)).toEqual(["u1", "u2"]);
    expect(data.rows.find((r: any) => r.userId === "u1").profileSubmitted).toBe(true);
    expect(data.rows.find((r: any) => r.userId === "u2").profileSubmitted).toBe(false);
    expect(data.domains.map((d: any) => d.key)).toEqual(["design", "fullstack"]);
  });

  it("filters rows by a valid ?domain=", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      decisionRow({
        userId: "u1",
        first: "Ada",
        domainCode: "fullstack",
        domainName: "Fullstack",
      }),
      decisionRow({ userId: "u2", first: "Bea", domainCode: "design", domainName: "Design" }),
    ]);

    const data = (await call("http://localhost/hiring/onboarding?domain=design")) as any;
    expect(data.selectedDomain).toBe("design");
    expect(data.domains.map((d: any) => d.key)).toEqual(["design", "fullstack"]);
    expect(data.rows.map((r: any) => r.userId)).toEqual(["u2"]);
  });

  it("ignores an unknown ?domain= and shows all rows", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      decisionRow({
        userId: "u1",
        first: "Ada",
        domainCode: "fullstack",
        domainName: "Fullstack",
      }),
      decisionRow({ userId: "u2", first: "Bea", domainCode: "design", domainName: "Design" }),
    ]);

    const data = (await call("http://localhost/hiring/onboarding?domain=bogus")) as any;
    expect(data.selectedDomain).toBeNull();
    expect(data.rows).toHaveLength(2);
  });
});

describe("hiring/onboarding action (toggle Figma)", () => {
  function postForm(fields: Record<string, string>) {
    const body = new URLSearchParams(fields);
    return action({
      request: new Request("http://localhost/hiring/onboarding", {
        method: "POST",
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      params: {},
      context: {},
    } as any);
  }

  beforeEach(() => {
    mockPrisma.user = { update: vi.fn().mockResolvedValue({}) };
  });

  it("stamps figmaInvitedAt when checking", async () => {
    const res = (await postForm({
      intent: "toggleFigma",
      userId: "u1",
      invited: "true",
    })) as Response;
    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.user.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "u1" });
    expect(arg.data.figmaInvitedAt).toBeInstanceOf(Date);
  });

  it("clears figmaInvitedAt when unchecking", async () => {
    await postForm({ intent: "toggleFigma", userId: "u1", invited: "false" });
    expect(mockPrisma.user.update.mock.calls[0][0].data.figmaInvitedAt).toBeNull();
  });

  it("403s for non-core users", async () => {
    vi.mocked(isCore).mockResolvedValueOnce(false);
    const res = (await postForm({
      intent: "toggleFigma",
      userId: "u1",
      invited: "true",
    })) as Response;
    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    const res = (await postForm({ intent: "somethingElse", userId: "u1" })) as Response;
    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe("hiring/onboarding action (remind)", () => {
  function postForm(fields: Record<string, string>) {
    const body = new URLSearchParams(fields);
    return action({
      request: new Request("http://localhost/hiring/onboarding", {
        method: "POST",
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      params: {},
      context: {},
    } as any);
  }

  beforeEach(() => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026", cycleType: "Standard" },
    ]);
    mockPrisma.decision.findMany.mockResolvedValue([
      // Complete email/slack/figma, missing profile
      decisionRow({
        userId: "u1",
        first: "Ada",
        domainCode: "fullstack",
        domainName: "Fullstack",
        daliEmail: "ada@dali.dartmouth.edu",
        slackUserId: "U1",
        figmaInvitedAt: new Date(),
        onboardedAt: null,
      }),
      // Missing email + profile; same person also in design (dedupe by userId)
      decisionRow({
        userId: "u2",
        first: "Bea",
        domainCode: "design",
        domainName: "Design",
        daliEmail: null,
        onboardedAt: null,
      }),
      decisionRow({
        userId: "u2",
        first: "Bea",
        domainCode: "fullstack",
        domainName: "Fullstack",
        daliEmail: null,
        onboardedAt: null,
      }),
      // Fully done — never reminded
      decisionRow({
        userId: "u3",
        first: "Cara",
        domainCode: "design",
        domainName: "Design",
        daliEmail: "cara@dali.dartmouth.edu",
        slackUserId: "U3",
        figmaInvitedAt: new Date(),
        onboardedAt: new Date(),
      }),
    ]);
  });

  it("reminds unique users incomplete on the profile step via DALI OS", async () => {
    const res = (await postForm({
      intent: "remind",
      step: "profile",
      via: "inApp",
      cycle: "cyc-new",
      domain: "",
    })) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      count: 2,
      skipped: 0,
      step: "profile",
      via: "inApp",
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
    const arg = vi.mocked(notify).mock.calls[0][0];
    expect(arg.eventType).toBe("member.onboarding.reminder");
    expect(arg.recipients.map((r: { userId: string }) => r.userId).sort()).toEqual([
      "u1",
      "u2",
    ]);
    expect(arg.message.link).toBe("/onboarding");
  });

  it("reminds only users missing email", async () => {
    const res = (await postForm({
      intent: "remind",
      step: "email",
      via: "inApp",
      cycle: "cyc-new",
      domain: "",
    })) as Response;
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(vi.mocked(notify).mock.calls[0][0].recipients).toEqual([{ userId: "u2" }]);
  });

  it("scopes remind to the domain filter", async () => {
    const res = (await postForm({
      intent: "remind",
      step: "profile",
      via: "inApp",
      cycle: "cyc-new",
      domain: "fullstack",
    })) as Response;
    const body = await res.json();
    // u1 (fullstack pending) + u2 (also has fullstack pending) — both unique
    expect(body.count).toBe(2);
  });

  it("emails Dartmouth only — never creates an in-app notification", async () => {
    mockPrisma.user = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "u1",
          firstName: "Ada",
          daliEmail: "ada@dali.dartmouth.edu",
          dartmouthEmail: "ada.t@dartmouth.edu",
        },
        {
          id: "u2",
          firstName: "Bea",
          daliEmail: null,
          dartmouthEmail: "bea.t@dartmouth.edu",
        },
      ]),
    };
    const res = (await postForm({
      intent: "remind",
      step: "profile",
      via: "emailDartmouth",
      cycle: "cyc-new",
      domain: "",
    })) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      count: 2,
      skipped: 0,
      via: "emailDartmouth",
    });
    expect(notify).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendEmail).mock.calls.map((c) => c[0].to).sort()).toEqual([
      "ada.t@dartmouth.edu",
      "bea.t@dartmouth.edu",
    ]);
  });

  it("skips members without the chosen email address", async () => {
    mockPrisma.user = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "u1",
          firstName: "Ada",
          daliEmail: "ada@dali.dartmouth.edu",
          dartmouthEmail: null,
        },
        {
          id: "u2",
          firstName: "Bea",
          daliEmail: null,
          dartmouthEmail: null,
        },
      ]),
    };
    const res = (await postForm({
      intent: "remind",
      step: "profile",
      via: "emailDali",
      cycle: "cyc-new",
      domain: "",
    })) as Response;
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, count: 1, skipped: 1, via: "emailDali" });
    expect(notify).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0][0].to).toBe("ada@dali.dartmouth.edu");
  });

  it("Slack DMs only — never creates an in-app notification", async () => {
    mockPrisma.user = {
      findMany: vi.fn().mockResolvedValue([
        { id: "u1", slackUserId: "U1" },
        { id: "u2", slackUserId: null },
      ]),
    };
    const res = (await postForm({
      intent: "remind",
      step: "profile",
      via: "slack",
      cycle: "cyc-new",
      domain: "",
    })) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      count: 1,
      skipped: 1,
      via: "slack",
    });
    expect(notify).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendDm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendDm).mock.calls[0][0]).toBe("U1");
    expect(vi.mocked(sendDm).mock.calls[0][1]).toContain("Onboarding reminder: profile form");
  });

  it("rejects an invalid step", async () => {
    const res = (await postForm({
      intent: "remind",
      step: "bogus",
      via: "inApp",
      cycle: "cyc-new",
    })) as Response;
    expect(res.status).toBe(400);
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects a missing via channel", async () => {
    const res = (await postForm({
      intent: "remind",
      step: "profile",
      cycle: "cyc-new",
    })) as Response;
    expect(res.status).toBe(400);
    expect(notify).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
