import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => {
  const tx = {
    staffingAssignment: { update: vi.fn(), updateMany: vi.fn() },
    projectAssignment: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    domainEligibility: { findUnique: vi.fn(), upsert: vi.fn() },
    staffingMentorRole: { findMany: vi.fn() },
    externalMentor: { findMany: vi.fn() },
  };
  const p = {
    staffingCycle: { findUnique: vi.fn() },
    project: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    staffingAssignment: { findMany: vi.fn() },
    domain: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prismaMock: p, txMock: tx };
});

vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ canManageStaffing: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/slack/lib/slack-client", () => ({
  postMessage: vi.fn(),
  ensureChannel: vi.fn(),
  inviteUsersToChannel: vi.fn(),
  slackErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  slackConfigured: vi.fn(),
  SLACK_NOT_CONFIGURED_MESSAGE: "slack not configured",
}));
vi.mock("~/members/lib/slack-sync.server", () => ({ resolveSlackIdsForInvite: vi.fn() }));
vi.mock("~/lib/github", () => ({ ensureTeam: vi.fn(), addTeamMember: vi.fn(), isNo2fa: () => false }));
vi.mock("~/lib/google-workspace", () => ({
  workspaceConfigured: vi.fn(),
  deriveProjectEmails: vi.fn(),
  ensureWorkspaceGroup: vi.fn(),
  addGroupMember: vi.fn(),
}));
vi.mock("~/projects/lib/finalize-external.server", () => ({
  externalFinalizeAllowed: vi.fn(),
  EXTERNAL_FINALIZE_SKIP_MESSAGE: "skipped non-prod",
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/promotion-notify.server", () => ({
  notifyAdminsOfPromotion: vi.fn(),
  isLevelAdvance: () => false,
}));
vi.mock("../../lib/staffing-events.server", () => ({ publishCycleChange: vi.fn() }));
vi.mock("../../lib/mentorship-pairings", () => ({
  derivePairings: vi.fn(),
  findDomainsMissingMentors: vi.fn(),
}));
vi.mock("../../lib/github-team-sync", () => ({ grantTeamRepos: vi.fn() }));

import { action } from "../api.staffing.finalize";
import { requireAuth } from "~/lib/auth";
import { notify } from "~/lib/notify.server";
import { canManageStaffing } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { externalFinalizeAllowed } from "~/projects/lib/finalize-external.server";
import { publishCycleChange } from "../../lib/staffing-events.server";
import { derivePairings, findDomainsMissingMentors } from "../../lib/mentorship-pairings";

const ACTOR = "lead-1";
const CYCLE = { id: "cyc-1", termId: "term-1", name: "26F" };
const PROJECT = {
  id: "proj-1",
  name: "Atlas",
  githubTeamSlug: null,
  slackChannelId: null,
  slackChannelName: null,
  repoUrls: [],
  teamGroupEmail: null,
};

function call(body: unknown, method = "POST") {
  return action({
    request: new Request("http://localhost/api/staffing/finalize", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
  } as any);
}
const valid = { cycleId: CYCLE.id, projectId: PROJECT.id, automations: ["assignments"] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: ACTOR } } as any);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  vi.mocked(externalFinalizeAllowed).mockReturnValue(false);
  vi.mocked(notify).mockResolvedValue(undefined as never);
  prismaMock.staffingCycle.findUnique.mockResolvedValue(CYCLE);
  prismaMock.project.findUnique.mockResolvedValue(PROJECT);
  prismaMock.staffingAssignment.findMany.mockResolvedValue([]);
  prismaMock.domain.findMany.mockResolvedValue([{ id: "dom-a", name: "Engineering" }]);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation(async (cb: (t: typeof txMock) => unknown) => cb(txMock));
  txMock.staffingMentorRole.findMany.mockResolvedValue([]);
  txMock.externalMentor.findMany.mockResolvedValue([]);
  txMock.projectAssignment.findMany.mockResolvedValue([]);
  txMock.domainEligibility.findUnique.mockResolvedValue(null);
  vi.mocked(derivePairings).mockResolvedValue(0);
  vi.mocked(findDomainsMissingMentors).mockReturnValue([]);
});

describe("POST /api/staffing/finalize request guards", () => {
  it("returns the auth response when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as any);
    expect((await call(valid)).status).toBe(401);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects non-POST with 405", async () => {
    expect((await call(valid, "PUT")).status).toBe(405);
  });

  it("rejects callers who cannot manage staffing with 403 and writes nothing", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    expect((await call(valid)).status).toBe(403);
    expect(canManageStaffing).toHaveBeenCalledWith(ACTOR);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    expect((await call("{nope")).status).toBe(400);
  });

  it.each([
    ["missing cycleId", { projectId: "p", automations: [] }],
    ["non-array automations", { cycleId: "c", projectId: "p", automations: "assignments" }],
    ["non-string automation entry", { cycleId: "c", projectId: "p", automations: [1] }],
    ["non-string slackChannel", { cycleId: "c", projectId: "p", automations: [], slackChannel: 3 }],
    ["non-boolean promoteMentors", { cycleId: "c", projectId: "p", automations: [], promoteMentors: "yes" }],
    ["non-boolean saveFieldsOnly", { cycleId: "c", projectId: "p", automations: [], saveFieldsOnly: 1 }],
  ])("rejects an invalid body: %s", async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid body" });
  });

  it("rejects a run with no recognised automations", async () => {
    const res = await call({ ...valid, automations: ["bogus"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No automations selected" });
  });

  it("404s for an unknown cycle and an unknown project", async () => {
    prismaMock.staffingCycle.findUnique.mockResolvedValue(null);
    expect((await call(valid)).status).toBe(404);
    prismaMock.staffingCycle.findUnique.mockResolvedValue(CYCLE);
    prismaMock.project.findUnique.mockResolvedValue(null);
    expect((await call(valid)).status).toBe(404);
  });
});

describe("saveFieldsOnly", () => {
  it("saves trimmed fields with no automations selected and runs nothing else", async () => {
    const res = await call({
      cycleId: CYCLE.id,
      projectId: PROJECT.id,
      automations: [],
      saveFieldsOnly: true,
      slackChannel: " atlas ",
      githubTeamSlug: "",
    });
    expect(await res.json()).toEqual({ saved: true });
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT.id },
      data: { slackChannelName: "atlas", githubTeamSlug: null },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("assignments step", () => {
  const sa = (over: object) => ({
    id: "sa-1",
    userId: "u-ada",
    projectId: PROJECT.id,
    domainId: "dom-a",
    level: "P2",
    status: "Proposed",
    ...over,
  });

  it("confirms the live roster, writes ProjectAssignment/eligibility for the term, audits and publishes", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([sa({})]);
    const res = await call(valid);
    const json = await res.json();

    expect(txMock.staffingAssignment.update).toHaveBeenCalledWith({
      where: { id: "sa-1" },
      data: { status: "Confirmed" },
    });
    expect(txMock.projectAssignment.upsert).toHaveBeenCalledWith({
      where: {
        userId_projectId_termId_domainId: {
          userId: "u-ada",
          projectId: PROJECT.id,
          termId: CYCLE.termId,
          domainId: "dom-a",
        },
      },
      update: { level: "P2" },
      create: { userId: "u-ada", projectId: PROJECT.id, termId: CYCLE.termId, domainId: "dom-a", level: "P2" },
    });
    expect(txMock.domainEligibility.upsert).toHaveBeenCalledWith({
      where: { userId_domainId: { userId: "u-ada", domainId: "dom-a" } },
      update: { level: "P2", promotedBy: ACTOR },
      create: { userId: "u-ada", domainId: "dom-a", level: "P2", promotedBy: ACTOR },
    });
    expect(json.results.assignments).toEqual({ status: "ok", message: "1 confirmed" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staffing.finalize",
        userId: ACTOR,
        targetId: PROJECT.id,
        metadata: expect.objectContaining({ cycleId: CYCLE.id, automations: ["assignments"], confirmedCount: 1 }),
      }),
    );
    expect(publishCycleChange).toHaveBeenCalledWith(CYCLE.id);
  });

  it("declines Confirmed rows no longer live and deletes their ProjectAssignment", async () => {
    prismaMock.domain.findMany.mockResolvedValue([
      { id: "dom-a", name: "Engineering" },
      { id: "dom-b", name: "Design" },
    ]);
    prismaMock.staffingAssignment.findMany.mockResolvedValue([
      sa({ id: "keep", domainId: "dom-a" }),
      sa({ id: "drop", domainId: "dom-b", status: "Confirmed" }),
    ]);
    const json = await (await call(valid)).json();
    expect(txMock.staffingAssignment.update).toHaveBeenCalledWith({ where: { id: "drop" }, data: { status: "Declined" } });
    expect(txMock.projectAssignment.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u-ada", projectId: PROJECT.id, termId: CYCLE.termId, domainId: "dom-b" },
    });
    expect(json.results.assignments.message).toBe("1 confirmed · 1 removed");
  });

  it("skips rows with an invalid domain and names the member", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([sa({ userId: "u-grace", domainId: "" })]);
    prismaMock.user.findMany.mockResolvedValue([{ firstName: "Grace", lastName: "Hopper" }]);
    const json = await (await call(valid)).json();
    expect(txMock.projectAssignment.upsert).not.toHaveBeenCalled();
    expect(json.results.assignments.status).toBe("error");
    expect(json.results.assignments.message).toContain("1 need a domain: Grace Hopper");
  });

  it("turns a transaction failure into an error result rather than a 500", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([sa({})]);
    prismaMock.$transaction.mockRejectedValue(new Error("fk violation"));
    const res = await call(valid);
    expect(res.status).toBe(200);
    expect((await res.json()).results.assignments).toEqual({ status: "error", message: "fk violation" });
  });

  it("promotes override mentors below P3 only when promoteMentors is true", async () => {
    txMock.staffingMentorRole.findMany.mockResolvedValue([{ userId: "u-ada", isMentor: true }]);
    txMock.projectAssignment.findMany.mockImplementation(async (a: { where: { level?: unknown } }) =>
      a.where.level ? [{ userId: "u-ada", domainId: "dom-a" }] : [],
    );
    await call(valid);
    expect(txMock.projectAssignment.updateMany).not.toHaveBeenCalled();

    const json = await (await call({ ...valid, promoteMentors: true })).json();
    expect(txMock.projectAssignment.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-ada", termId: CYCLE.termId, domainId: "dom-a" },
      data: { level: "P3" },
    });
    expect(json.results.assignments.message).toContain("1 promoted to P3");
  });
});

describe("external steps are gated off-prod", () => {
  it("skips slack, gmail and github without calling any external API", async () => {
    const json = await (await call({ ...valid, automations: ["slack", "gmail", "github"] })).json();
    expect(json.results).toEqual({
      slack: { status: "skipped", message: "skipped non-prod" },
      gmail: { status: "skipped", message: "skipped non-prod" },
      github: { status: "skipped", message: "skipped non-prod" },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
