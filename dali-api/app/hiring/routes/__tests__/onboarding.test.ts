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
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(),
  drainNow: vi.fn(),
}));
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
import { enqueueOutbound } from "~/lib/outbound.server";
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
  /** The applicant's own start-term pick; absent means they have none. */
  startTermId?: string | null;
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
        startTermId: over.startTermId ?? null,
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
  // The board resolves start-term codes, so the calendar is always read.
  mockPrisma.term = {
    findMany: vi.fn().mockResolvedValue([
      { id: "t-26w", code: "26W", sortKey: 20261 },
      { id: "t-26s", code: "26S", sortKey: 20262 },
      { id: "t-26x", code: "26X", sortKey: 20263 },
      { id: "t-26f", code: "26F", sortKey: 20264 },
    ]),
    // Always a spy, so a test can assert the clear path never looks a term up.
    findUnique: vi.fn(),
  };
  mockPrisma.application = { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: CORE_ID, type: "member" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(getUserRoles).mockResolvedValue(CORE_ROLES as any);
  vi.mocked(notify).mockResolvedValue(undefined as any);
  vi.mocked(enqueueOutbound).mockResolvedValue({ id: "om-x", deduped: false });
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
      { id: "cyc-new", name: "Spring 2026" },
      { id: "cyc-old", name: "Fall 2025" },
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
    // The query is unscoped — cycle, start term, and domain are all row
    // predicates now, so the roster is fetched once and narrowed in memory.
    expect(mockPrisma.decision.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrisma.decision.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ stage: "Released", type: "Accepted" });

    expect(data.rows).toEqual([
      {
        userId: "u1",
        name: "Ada Test",
        photoUrl: null,
        domainKey: "fullstack",
        role: "Fullstack",
        cycleId: "cyc-new",
        cycleName: "Spring 2026",
        startTermId: null,
        startTermCode: null,
        ownStartTermId: null,
        cycleTermSortKey: null,
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
        startTermId: null,
        startTermCode: null,
        ownStartTermId: null,
        cycleTermSortKey: null,
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
      { id: "cyc-new", name: "Spring 2026" },
      { id: "cyc-old", name: "Fall 2025" },
    ]);
    const data = (await call("http://localhost/hiring/onboarding?cycle=cyc-old")) as any;
    expect(data.selectedCycleId).toBe("cyc-old");
  });

  it("falls back to the newest cycle when ?cycle= is unknown", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026" },
    ]);
    const data = (await call("http://localhost/hiring/onboarding?cycle=bogus")) as any;
    expect(data.selectedCycleId).toBe("cyc-new");
  });

  it("loads all cycles when ?cycle=all", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026" },
      { id: "cyc-old", name: "Fall 2025" },
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
    expect(where).toEqual({ stage: "Released", type: "Accepted" });
    expect(data.rows).toHaveLength(2);
    expect(data.rows.map((r: any) => r.cycleName).sort()).toEqual([
      "Fall 2025",
      "Spring 2026",
    ]);
  });

  // The start term belongs to the HIRE, not to their cycle, so the two filters
  // are independent predicates over the accepted set and picking both
  // intersects. Neither narrows what the other offers.
  describe("start term filter", () => {
    // Two cycles, each anchored to the term its hiring ran in.
    const CYCLES = [
      { id: "cyc-s26", name: "Spring 2026", termId: "t-26s" },
      { id: "cyc-w26", name: "Winter 2026", termId: "t-26w" },
      { id: "cyc-none", name: "Ad hoc", termId: null },
    ];

    // Ada applied in the 26S cycle and starts then (no pick of her own).
    // Bo applied in the same cycle but was DEFERRED to 26F.
    // Cy applied in the 26W cycle and starts then.
    // Di's cycle has no term and Di has no pick, so nothing says when they start.
    const ROSTER = [
      decisionRow({ userId: "u-ada", first: "Ada", domainCode: "dev", domainName: "Dev", cycleId: "cyc-s26", cycleName: "Spring 2026" }),
      decisionRow({ userId: "u-bo", first: "Bo", domainCode: "design", domainName: "Design", cycleId: "cyc-s26", cycleName: "Spring 2026", startTermId: "t-26f" }),
      decisionRow({ userId: "u-cy", first: "Cy", domainCode: "dev", domainName: "Dev", cycleId: "cyc-w26", cycleName: "Winter 2026" }),
      decisionRow({ userId: "u-di", first: "Di", domainCode: "dev", domainName: "Dev", cycleId: "cyc-none", cycleName: "Ad hoc" }),
    ];

    const names = (data: any) => data.rows.map((r: any) => r.name.split(" ")[0]).sort();

    beforeEach(() => {
      mockPrisma.applicationCycle.findMany.mockResolvedValue(CYCLES);
      mockPrisma.decision.findMany.mockResolvedValue(ROSTER);
    });

    it("falls back to the cycle's term for a hire with no pick of their own", async () => {
      const data = (await call("http://localhost/hiring/onboarding?cycle=all")) as any;
      const ada = data.rows.find((r: any) => r.userId === "u-ada");
      expect(ada).toMatchObject({
        startTermId: "t-26s",
        startTermCode: "26S",
        ownStartTermId: null,
      });
    });

    it("uses the hire's own pick over their cycle's term", async () => {
      const data = (await call("http://localhost/hiring/onboarding?cycle=all")) as any;
      const bo = data.rows.find((r: any) => r.userId === "u-bo");
      expect(bo).toMatchObject({
        startTermId: "t-26f",
        startTermCode: "26F",
        ownStartTermId: "t-26f",
      });
    });

    it("offers the start terms the roster actually uses, newest first", async () => {
      const data = (await call("http://localhost/hiring/onboarding?cycle=all")) as any;
      // 26F because Bo was deferred into it, even though no CYCLE runs in it.
      expect(data.terms).toEqual([
        { id: "t-26f", code: "26F" },
        { id: "t-26s", code: "26S" },
        { id: "t-26w", code: "26W" },
      ]);
      expect(data.selectedTermId).toBeNull();
    });

    it("filters rows by start term without touching the cycle list", async () => {
      const data = (await call("http://localhost/hiring/onboarding?term=t-26f")) as any;
      expect(data.selectedTermId).toBe("t-26f");
      // Only the deferred hire starts in 26F, from a cycle that ran in 26S.
      expect(names(data)).toEqual(["Bo"]);
      // Every cycle is still offered — the term no longer narrows the list.
      expect(data.cycles.map((c: any) => c.id)).toEqual(["cyc-s26", "cyc-w26", "cyc-none"]);
    });

    it("opens the cycle filter at all when a term is picked alone", async () => {
      const data = (await call("http://localhost/hiring/onboarding?term=t-26s")) as any;
      expect(data.selectedCycleId).toBe("all");
      expect(names(data)).toEqual(["Ada"]);
    });

    it("intersects an explicit cycle with an explicit start term", async () => {
      const data = (await call(
        "http://localhost/hiring/onboarding?cycle=cyc-s26&term=t-26f",
      )) as any;
      expect(data.selectedCycleId).toBe("cyc-s26");
      expect(data.selectedTermId).toBe("t-26f");
      // Of the 26S cycle's two hires, only the one deferred to 26F.
      expect(names(data)).toEqual(["Bo"]);
    });

    it("returns nothing when the two filters don't overlap", async () => {
      const data = (await call(
        "http://localhost/hiring/onboarding?cycle=cyc-w26&term=t-26f",
      )) as any;
      expect(data.rows).toEqual([]);
    });

    it("filters by cycle alone across every start term in it", async () => {
      const data = (await call("http://localhost/hiring/onboarding?cycle=cyc-s26")) as any;
      expect(data.selectedTermId).toBeNull();
      expect(names(data)).toEqual(["Ada", "Bo"]);
    });

    it("buckets a hire with no pick and no cycle term under ?term=none", async () => {
      const data = (await call("http://localhost/hiring/onboarding?term=none")) as any;
      expect(data.hasUntermed).toBe(true);
      expect(data.selectedTermId).toBe("none");
      expect(names(data)).toEqual(["Di"]);
    });

    it("drops ?term=none when every hire has a start term", async () => {
      mockPrisma.decision.findMany.mockResolvedValue(ROSTER.slice(0, 3));
      const data = (await call("http://localhost/hiring/onboarding?term=none")) as any;
      expect(data.hasUntermed).toBe(false);
      expect(data.selectedTermId).toBeNull();
    });

    it("ignores an unknown ?term= and keeps the newest cycle", async () => {
      const data = (await call("http://localhost/hiring/onboarding?term=bogus")) as any;
      expect(data.selectedTermId).toBeNull();
      expect(data.selectedCycleId).toBe("cyc-s26");
    });

    it("offers only the domains the other two filters left", async () => {
      const data = (await call("http://localhost/hiring/onboarding?term=t-26f")) as any;
      // 26F holds only Bo, a designer, so Dev isn't offered.
      expect(data.domains).toEqual([{ key: "design", label: "Design" }]);
    });

    it("exposes the cycle's term as each row's editor floor", async () => {
      const data = (await call("http://localhost/hiring/onboarding?cycle=all")) as any;
      expect(data.rows.find((r: any) => r.userId === "u-ada").cycleTermSortKey).toBe(20262);
      expect(data.rows.find((r: any) => r.userId === "u-di").cycleTermSortKey).toBeNull();
    });
  });

  it("collapses duplicate accepted decisions for the same user+domain+cycle to one row", async () => {
    mockPrisma.applicationCycle.findMany.mockResolvedValue([
      { id: "cyc-new", name: "Spring 2026" },
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
      { id: "cyc-new", name: "Spring 2026" },
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
      { id: "cyc-new", name: "Spring 2026" },
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
      { id: "cyc-new", name: "Spring 2026" },
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
      { id: "cyc-new", name: "Spring 2026" },
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
    expect(enqueueOutbound).toHaveBeenCalledTimes(2);
    expect(vi.mocked(enqueueOutbound).mock.calls.map((c) => c[0].target).sort()).toEqual([
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
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueueOutbound).mock.calls[0][0].target).toBe("ada@dali.dartmouth.edu");
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

// Core moving one hire's start term. Not limited to the cycle's offered set —
// that was the applicants' menu, and a deferral is decided afterward — but it
// is floored at the term the hiring ran in.
describe("hiring/onboarding action (set start term)", () => {
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

  const base = {
    intent: "setStartTerm",
    userId: "u-bo",
    cycleId: "cyc-s26",
  };

  beforeEach(() => {
    // The 26S cycle: its own term is the floor for every hire in it.
    mockPrisma.application.findUnique.mockResolvedValue({
      id: "app-bo",
      applicationCycle: { term: { sortKey: 20262 } },
    });
  });

  it("stores a later term — the deferral case", async () => {
    mockPrisma.term.findUnique.mockResolvedValue({ sortKey: 20264 });
    const res = (await postForm({ ...base, termId: "t-26f" })) as Response;
    expect(res.status).toBe(200);
    expect(mockPrisma.application.update).toHaveBeenCalledWith({
      where: { id: "app-bo" },
      data: { startTermId: "t-26f" },
    });
  });

  it("stores the cycle's own term", async () => {
    mockPrisma.term.findUnique.mockResolvedValue({ sortKey: 20262 });
    await postForm({ ...base, termId: "t-26s" });
    expect(mockPrisma.application.update.mock.calls[0][0].data).toEqual({
      startTermId: "t-26s",
    });
  });

  it("refuses a term before the one the hiring ran in", async () => {
    mockPrisma.term.findUnique.mockResolvedValue({ sortKey: 20261 });
    const res = (await postForm({ ...base, termId: "t-26w" })) as Response;
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/can't be before the term the cycle ran in/i),
    });
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
  });

  it("allows any term when the cycle has no term of its own", async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: "app-di",
      applicationCycle: { term: null },
    });
    mockPrisma.term.findUnique.mockResolvedValue({ sortKey: 20261 });
    const res = (await postForm({ ...base, termId: "t-26w" })) as Response;
    expect(res.status).toBe(200);
    expect(mockPrisma.application.update).toHaveBeenCalled();
  });

  it("clears the pick back to the cycle's term on an empty value", async () => {
    const res = (await postForm({ ...base, termId: "" })) as Response;
    expect(res.status).toBe(200);
    expect(mockPrisma.application.update).toHaveBeenCalledWith({
      where: { id: "app-bo" },
      data: { startTermId: null },
    });
    // Clearing needs no term lookup at all.
    expect(mockPrisma.term.findUnique).not.toHaveBeenCalled();
  });

  it("404s when that user has no application in that cycle", async () => {
    mockPrisma.application.findUnique.mockResolvedValue(null);
    const res = (await postForm({ ...base, termId: "t-26f" })) as Response;
    expect(res.status).toBe(404);
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
  });

  it("400s on an unknown term", async () => {
    mockPrisma.term.findUnique.mockResolvedValue(null);
    const res = (await postForm({ ...base, termId: "t-nope" })) as Response;
    expect(res.status).toBe(400);
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
  });

  it("400s without a userId or cycleId", async () => {
    const res = (await postForm({ intent: "setStartTerm", termId: "t-26f" })) as Response;
    expect(res.status).toBe(400);
    expect(mockPrisma.application.findUnique).not.toHaveBeenCalled();
  });

  it("403s for non-core users", async () => {
    vi.mocked(isCore).mockResolvedValueOnce(false);
    const res = (await postForm({ ...base, termId: "t-26f" })) as Response;
    expect(res.status).toBe(403);
    expect(mockPrisma.application.update).not.toHaveBeenCalled();
  });
});
