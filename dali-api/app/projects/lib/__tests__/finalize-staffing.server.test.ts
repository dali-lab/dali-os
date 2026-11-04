import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

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
    staffingMentorRole: { findMany: vi.fn() },
    externalMentor: { findMany: vi.fn() },
    domain: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    coreAssignment: { findMany: vi.fn() },
    adminMembership: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prismaMock: p, txMock: tx };
});

vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));
vi.mock("~/slack/lib/slack-client", () => ({
  postMessage: vi.fn(),
  ensureChannel: vi.fn(),
  inviteUsersToChannel: vi.fn(),
  slackErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  slackConfigured: vi.fn(),
  SLACK_NOT_CONFIGURED_MESSAGE: "slack not configured",
}));
vi.mock("~/members/lib/slack-sync.server", () => ({ resolveSlackIdsForInvite: vi.fn() }));
vi.mock("~/lib/github", () => ({
  ensureTeam: vi.fn(),
  addTeamMember: vi.fn(),
  isNo2fa: (e: unknown) => e instanceof Error && e.message === "no2fa",
}));
vi.mock("~/lib/google-workspace", () => ({
  workspaceConfigured: vi.fn(),
  deriveProjectEmails: vi.fn(() => ({ groupEmail: "derived-team@example.edu" })),
  ensureWorkspaceGroup: vi.fn(),
  addGroupMember: vi.fn(),
}));
vi.mock("~/projects/lib/finalize-external.server", () => ({
  externalFinalizeAllowed: vi.fn(),
  EXTERNAL_FINALIZE_SKIP_MESSAGE: "skipped non-prod",
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/promotion-notify.server", () => {
  const rank = { P1: 1, P2: 2, P3: 3 } as Record<string, number>;
  return {
    notifyAdminsOfPromotion: vi.fn(),
    isLevelAdvance: (from: string | null, to: string) => from !== null && rank[to] > rank[from],
  };
});
vi.mock("../staffing-events.server", () => ({ publishCycleChange: vi.fn() }));
vi.mock("../mentorship-pairings", () => ({
  derivePairings: vi.fn(),
  findDomainsMissingMentors: vi.fn(),
}));
vi.mock("../github-team-sync", () => ({ grantTeamRepos: vi.fn() }));

import { finalizeStaffing } from "../finalize-staffing.server";
import { ensureChannel, inviteUsersToChannel, postMessage, slackConfigured } from "~/slack/lib/slack-client";
import { resolveSlackIdsForInvite } from "~/members/lib/slack-sync.server";
import { ensureTeam, addTeamMember } from "~/lib/github";
import { workspaceConfigured, ensureWorkspaceGroup, addGroupMember } from "~/lib/google-workspace";
import { externalFinalizeAllowed } from "~/projects/lib/finalize-external.server";
import { logAuditEvent } from "~/lib/audit";
import { notify } from "~/lib/notify.server";
import { notifyAdminsOfPromotion } from "~/lib/promotion-notify.server";
import { publishCycleChange } from "../staffing-events.server";
import { derivePairings, findDomainsMissingMentors } from "../mentorship-pairings";
import { grantTeamRepos } from "../github-team-sync";

const ACTOR = "actor-1";
const request = new Request("http://localhost/x", { method: "POST" });
const CYCLE = { id: "cyc-1", termId: "term-1", name: "26F" };
const PROJECT = {
  id: "proj-1",
  name: "Atlas",
  githubTeamSlug: null as string | null,
  slackChannelId: null as string | null,
  slackChannelName: null as string | null,
  repoUrls: [] as string[],
  teamGroupEmail: null as string | null,
};
const DOMAINS = [
  { id: "dom-a", name: "Engineering", displayName: "Engineering" },
  { id: "dom-b", name: "Design", displayName: "Design" },
];

function row(over: Partial<{ id: string; userId: string; projectId: string; domainId: string; level: string; status: string }>) {
  return { id: "sa-1", userId: "u-ada", projectId: PROJECT.id, domainId: "dom-a", level: "P2", status: "Proposed", ...over };
}

function run(body: Partial<Parameters<typeof finalizeStaffing>[1]> = {}) {
  return finalizeStaffing(
    ACTOR,
    { cycleId: CYCLE.id, projectId: PROJECT.id, automations: ["assignments"], ...body },
    request,
  );
}

let project: typeof PROJECT;

beforeEach(() => {
  vi.resetAllMocks();
  project = { ...PROJECT };
  prismaMock.staffingCycle.findUnique.mockResolvedValue(CYCLE);
  prismaMock.project.findUnique.mockImplementation(async () => project);
  prismaMock.project.count.mockResolvedValue(0);
  prismaMock.staffingAssignment.findMany.mockResolvedValue([]);
  prismaMock.domain.findMany.mockResolvedValue(DOMAINS);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.staffingMentorRole.findMany.mockResolvedValue([]);
  prismaMock.externalMentor.findMany.mockResolvedValue([]);
  prismaMock.coreAssignment.findMany.mockResolvedValue([]);
  prismaMock.adminMembership.findMany.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation(async (cb: (t: typeof txMock) => unknown) => cb(txMock));
  txMock.staffingMentorRole.findMany.mockResolvedValue([]);
  txMock.externalMentor.findMany.mockResolvedValue([]);
  txMock.projectAssignment.findMany.mockResolvedValue([]);
  txMock.domainEligibility.findUnique.mockResolvedValue(null);
  vi.mocked(derivePairings).mockResolvedValue(0);
  vi.mocked(findDomainsMissingMentors).mockReturnValue([]);
  vi.mocked(notify).mockResolvedValue(undefined as never);
  vi.mocked(notifyAdminsOfPromotion).mockResolvedValue(undefined as never);
  vi.mocked(externalFinalizeAllowed).mockReturnValue(true);
  vi.mocked(grantTeamRepos).mockResolvedValue([]);
});

describe("finalizeStaffing guards", () => {
  it("throws when the cycle does not exist", async () => {
    prismaMock.staffingCycle.findUnique.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("Cycle not found");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("throws when the project does not exist", async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("Project not found");
  });

  it("ignores unknown automation names and returns results only for known ones", async () => {
    const out = await run({ automations: ["assignments", "bogus"] });
    expect(Object.keys((out as { results: object }).results)).toEqual(["assignments"]);
  });
});

describe("saveFieldsOnly", () => {
  it("trims and persists the slack channel and github slug, runs no automations", async () => {
    const out = await run({
      saveFieldsOnly: true,
      automations: ["assignments", "slack"],
      slackChannel: "  atlas-team ",
      githubTeamSlug: " atlas ",
    });
    expect(out).toEqual({ saved: true });
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT.id },
      data: { slackChannelName: "atlas-team", githubTeamSlug: "atlas" },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("clears a field to null when given a blank string", async () => {
    await run({ saveFieldsOnly: true, slackChannel: "   " });
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT.id },
      data: { slackChannelName: null },
    });
  });

  it("does not write when neither field is supplied", async () => {
    await run({ saveFieldsOnly: true });
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });
});

describe("assignments step", () => {
  it("confirms Proposed rows and upserts ProjectAssignment + DomainEligibility with the term and actor", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([
      row({ id: "sa-1", userId: "u-ada", level: "P2" }),
    ]);
    const out = (await run()) as { results: Record<string, { status: string; message: string }> };

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
    expect(out.results.assignments).toEqual({ status: "ok", message: "1 confirmed" });
  });

  it("does not re-update already Confirmed rows but still upserts the real assignment (idempotent re-run)", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([row({ status: "Confirmed" })]);
    await run();
    expect(txMock.staffingAssignment.update).not.toHaveBeenCalled();
    expect(txMock.projectAssignment.upsert).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("only finalizes rows for this project; other projects' rows are untouched", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([
      row({ id: "sa-1" }),
      row({ id: "sa-2", userId: "u-grace", projectId: "proj-other" }),
    ]);
    await run();
    expect(txMock.projectAssignment.upsert).toHaveBeenCalledTimes(1);
    expect(txMock.staffingAssignment.update).toHaveBeenCalledWith({
      where: { id: "sa-1" },
      data: { status: "Confirmed" },
    });
  });

  it("declines Confirmed rows whose domain is no longer live and deletes their ProjectAssignment", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([
      row({ id: "sa-keep", userId: "u-ada", domainId: "dom-a", status: "Proposed" }),
      row({ id: "sa-drop", userId: "u-ada", domainId: "dom-b", status: "Confirmed" }),
    ]);
    const out = (await run()) as { results: Record<string, { message: string }> };
    expect(txMock.staffingAssignment.update).toHaveBeenCalledWith({
      where: { id: "sa-drop" },
      data: { status: "Declined" },
    });
    expect(txMock.projectAssignment.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u-ada", projectId: PROJECT.id, termId: CYCLE.termId, domainId: "dom-b" },
    });
    expect(out.results.assignments.message).toBe("1 confirmed · 1 removed");
  });

  it("never revokes DomainEligibility for dropped rows", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([
      row({ id: "sa-keep", domainId: "dom-a", status: "Proposed" }),
      row({ id: "sa-drop", domainId: "dom-b", status: "Confirmed" }),
    ]);
    await run();
    expect(txMock.domainEligibility.upsert).toHaveBeenCalledTimes(1);
  });

  it("reports 'Nothing proposed' when there is nothing to confirm or drop", async () => {
    const out = (await run()) as { results: Record<string, { status: string; message: string }> };
    expect(out.results.assignments).toEqual({ status: "ok", message: "Nothing proposed" });
  });

  it("skips rows whose domain does not exist, names the members, and reports an error without writing them", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([
      row({ id: "sa-ok", userId: "u-ada" }),
      row({ id: "sa-bad", userId: "u-grace", domainId: "" }),
    ]);
    prismaMock.user.findMany.mockResolvedValue([{ firstName: "Grace", lastName: "Hopper" }]);
    const out = (await run()) as { results: Record<string, { status: string; message: string }> };

    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["u-grace"] } },
      select: { firstName: true, lastName: true },
    });
    expect(txMock.projectAssignment.upsert).toHaveBeenCalledTimes(1);
    expect(out.results.assignments.status).toBe("error");
    expect(out.results.assignments.message).toBe("1 confirmed · 1 need a domain: Grace Hopper");
  });

  it("turns a transaction failure into an assignments error result and still audits", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([row({})]);
    prismaMock.$transaction.mockRejectedValue(new Error("fk violation"));
    const out = (await run()) as { results: Record<string, { status: string; message: string }> };
    expect(out.results.assignments).toEqual({ status: "error", message: "fk violation" });
    expect(notify).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("reports paired count and unpaired mentee gaps", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([row({})]);
    vi.mocked(derivePairings).mockResolvedValue(2);
    vi.mocked(findDomainsMissingMentors).mockReturnValue([
      { domainId: "dom-a", menteeUserIds: ["u-ada", "u-x"] },
    ]);
    prismaMock.user.findMany.mockImplementation(async (a: { where: { id: { in: string[] } } }) =>
      a.where.id.in.includes("u-x") ? [{ id: "u-ada", firstName: "Ada", lastName: "Lovelace" }] : [],
    );
    const out = (await run()) as { results: Record<string, { message: string }> };
    expect(out.results.assignments.message).toBe(
      "1 confirmed · 2 paired · unpaired: Engineering (Ada Lovelace, u-x) — needs a P3/Mentor",
    );
  });

  it("feeds mentor-role overrides and this project's external mentors into pairing", async () => {
    txMock.staffingMentorRole.findMany.mockResolvedValue([
      { userId: "u-ada", isMentor: true },
      { userId: "u-grace", isMentor: false },
    ]);
    txMock.externalMentor.findMany.mockResolvedValue([{ userId: "u-ext", domainId: "dom-a" }]);
    await run();
    expect(txMock.externalMentor.findMany).toHaveBeenCalledWith({
      where: { staffingCycleId: CYCLE.id, projectId: PROJECT.id },
      select: { userId: true, domainId: true },
    });
    expect(derivePairings).toHaveBeenCalledWith(txMock, PROJECT.id, CYCLE.termId, {
      roleOverride: new Map([
        ["u-ada", true],
        ["u-grace", false],
      ]),
      externalMentors: [{ userId: "u-ext", domainId: "dom-a" }],
    });
  });

  describe("promoteMentors", () => {
    beforeEach(() => {
      txMock.staffingMentorRole.findMany.mockResolvedValue([
        { userId: "u-ada", isMentor: true },
        { userId: "u-grace", isMentor: false },
      ]);
      txMock.projectAssignment.findMany.mockImplementation(async (args: { where: { level?: unknown } }) =>
        args.where.level ? [{ userId: "u-ada", domainId: "dom-a" }] : [],
      );
    });

    it("raises override mentors below P3 to P3 across assignment, eligibility and staffing rows", async () => {
      const out = (await run({ promoteMentors: true })) as { results: Record<string, { message: string }> };

      expect(txMock.projectAssignment.findMany).toHaveBeenCalledWith({
        where: {
          projectId: PROJECT.id,
          termId: CYCLE.termId,
          userId: { in: ["u-ada"] },
          level: { not: "P3" },
        },
        select: { userId: true, domainId: true },
      });
      expect(txMock.domainEligibility.upsert).toHaveBeenCalledWith({
        where: { userId_domainId: { userId: "u-ada", domainId: "dom-a" } },
        update: { level: "P3", promotedBy: ACTOR },
        create: { userId: "u-ada", domainId: "dom-a", level: "P3", promotedBy: ACTOR },
      });
      expect(txMock.projectAssignment.updateMany).toHaveBeenCalledWith({
        where: { userId: "u-ada", termId: CYCLE.termId, domainId: "dom-a" },
        data: { level: "P3" },
      });
      expect(txMock.staffingAssignment.updateMany).toHaveBeenCalledWith({
        where: {
          userId: "u-ada",
          staffingCycleId: CYCLE.id,
          domainId: "dom-a",
          status: { not: "Declined" },
        },
        data: { level: "P3" },
      });
      expect(out.results.assignments.message).toBe("Nothing proposed · 1 promoted to P3");
    });

    it("promotes nobody unless promoteMentors is exactly true", async () => {
      await run({ promoteMentors: false });
      await run({});
      expect(txMock.projectAssignment.updateMany).not.toHaveBeenCalled();
    });

    it("does not look for promotions when no override mentors exist", async () => {
      txMock.staffingMentorRole.findMany.mockResolvedValue([{ userId: "u-grace", isMentor: false }]);
      await run({ promoteMentors: true });
      expect(txMock.projectAssignment.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ level: { not: "P3" } }) }),
      );
    });
  });

  describe("notifications", () => {
    it("notifies only newly confirmed members, with domain, level and cycle in the detail", async () => {
      prismaMock.staffingAssignment.findMany.mockResolvedValue([
        row({ id: "sa-1", userId: "u-ada", status: "Proposed" }),
        row({ id: "sa-2", userId: "u-grace", domainId: "dom-b", level: "P1", status: "Confirmed" }),
      ]);
      await run();
      expect(notify).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(notify).mock.calls[0][0] as {
        eventType: string;
        createdByUserId: string;
        recipients: { userId: string; vars: { itemDetail: string } }[];
        message: { vars: { itemTitle: string }; link: string };
      };
      expect(arg.eventType).toBe("staffing.assigned");
      expect(arg.createdByUserId).toBe(ACTOR);
      expect(arg.message).toEqual({ vars: { itemTitle: "Atlas" }, link: "/projects/proj-1" });
      expect(arg.recipients).toEqual([
        { userId: "u-ada", vars: { itemDetail: "Engineering — P2, 26F." } },
      ]);
    });

    it("a notify failure does not fail the finalize", async () => {
      prismaMock.staffingAssignment.findMany.mockResolvedValue([row({})]);
      vi.mocked(notify).mockRejectedValue(new Error("boom"));
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const out = (await run()) as { results: Record<string, { status: string }> };
      expect(out.results.assignments.status).toBe("ok");
      spy.mockRestore();
    });

    it("tells admins only about genuine level advances, not first grants or equal levels", async () => {
      prismaMock.staffingAssignment.findMany.mockResolvedValue([
        row({ id: "1", userId: "u-up", level: "P3" }),
        row({ id: "2", userId: "u-new", level: "P1" }),
        row({ id: "3", userId: "u-same", level: "P2" }),
        row({ id: "4", userId: "u-down", level: "P1" }),
      ]);
      const prior: Record<string, string | null> = { "u-up": "P2", "u-new": null, "u-same": "P2", "u-down": "P3" };
      txMock.domainEligibility.findUnique.mockImplementation(
        async (a: { where: { userId_domainId: { userId: string } } }) => {
          const lvl = prior[a.where.userId_domainId.userId];
          return lvl ? { level: lvl } : null;
        },
      );
      await run();
      expect(notifyAdminsOfPromotion).toHaveBeenCalledTimes(1);
      expect(notifyAdminsOfPromotion).toHaveBeenCalledWith({
        userId: "u-up",
        actorId: ACTOR,
        summary: "was promoted to P3 in Engineering",
      });
    });

    it("keeps the first-seen prior level when a user is bumped twice (confirm then mentor promotion)", async () => {
      prismaMock.staffingAssignment.findMany.mockResolvedValue([row({ userId: "u-ada", level: "P2" })]);
      txMock.domainEligibility.findUnique.mockResolvedValue({ level: "P1" });
      txMock.staffingMentorRole.findMany.mockResolvedValue([{ userId: "u-ada", isMentor: true }]);
      txMock.projectAssignment.findMany.mockImplementation(async (args: { where: { level?: unknown } }) =>
        args.where.level ? [{ userId: "u-ada", domainId: "dom-a" }] : [],
      );
      await run({ promoteMentors: true });
      expect(txMock.domainEligibility.findUnique).toHaveBeenCalledTimes(1);
      expect(notifyAdminsOfPromotion).toHaveBeenCalledTimes(1);
      expect(vi.mocked(notifyAdminsOfPromotion).mock.calls[0][0].summary).toBe("was promoted to P3 in Engineering");
    });
  });
});

describe("audit and push", () => {
  it("audits with the actor, project, automations and confirmed count, then publishes the cycle change", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([row({})]);
    await run();
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "staffing.finalize",
      userId: ACTOR,
      targetId: PROJECT.id,
      metadata: {
        cycleId: CYCLE.id,
        automations: ["assignments"],
        confirmedCount: 1,
        results: { assignments: { status: "ok", message: "1 confirmed" } },
      },
      request,
    });
    expect(publishCycleChange).toHaveBeenCalledWith(CYCLE.id);
  });
});

describe("slack step", () => {
  const user = (id: string, first: string, last: string) => ({
    id,
    firstName: first,
    lastName: last,
    slackUserId: null,
    daliEmail: null,
    dartmouthEmail: null,
    personalEmail: null,
  });

  it("is skipped off-prod and touches no Slack API", async () => {
    vi.mocked(externalFinalizeAllowed).mockReturnValue(false);
    const out = (await run({ automations: ["slack"] })) as { results: Record<string, unknown> };
    expect(out.results.slack).toEqual({ status: "skipped", message: "skipped non-prod" });
    expect(ensureChannel).not.toHaveBeenCalled();
  });

  it("is skipped when Slack is not configured", async () => {
    vi.mocked(slackConfigured).mockReturnValue(false);
    const out = (await run({ automations: ["slack"] })) as { results: Record<string, unknown> };
    expect(out.results.slack).toEqual({ status: "skipped", message: "slack not configured" });
  });

  describe("when configured", () => {
    beforeEach(() => {
      vi.mocked(slackConfigured).mockReturnValue(true);
      vi.mocked(ensureChannel).mockResolvedValue({ id: "C1", name: "atlas", created: true } as never);
      vi.mocked(inviteUsersToChannel).mockResolvedValue({ invited: 2 } as never);
      vi.mocked(resolveSlackIdsForInvite).mockResolvedValue({ slackIds: ["S1", "S2"], unresolvedUserIds: ["x"] } as never);
      prismaMock.staffingAssignment.findMany.mockResolvedValue([
        { level: "P3", domainId: "dom-a", user: user("u-grace", "Grace", "Hopper") },
        { level: "P1", domainId: "dom-a", user: user("u-ada", "Ada", "Lovelace") },
        { level: "P1", domainId: "dom-b", user: user("u-bob", "Bob", "Zed") },
      ]);
      prismaMock.externalMentor.findMany.mockResolvedValue([
        { domainId: "dom-b", user: { firstName: "Alan", lastName: "Turing" } },
      ]);
    });

    it("creates the channel from the project name, caches id+name, invites, and posts a grouped team announcement", async () => {
      project.repoUrls = ["https://github.com/example/atlas"];
      const out = (await run({ automations: ["slack"] })) as { results: Record<string, { status: string; message: string }> };

      expect(ensureChannel).toHaveBeenCalledWith("Atlas");
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: PROJECT.id },
        data: { slackChannelId: "C1", slackChannelName: "Atlas" },
      });
      expect(inviteUsersToChannel).toHaveBeenCalledWith("C1", ["S1", "S2"]);
      expect(postMessage).toHaveBeenCalledWith(
        "C1",
        "*Welcome to Atlas 26F!* Here are your team and repos for the term :tada:\n\n" +
          "*Team*\n*Design*\n• Alan Turing (mentor)\n• Bob Zed\n\n" +
          "*Engineering*\n• Grace Hopper (mentor)\n• Ada Lovelace\n\n" +
          "*Repos*\n• https://github.com/example/atlas",
      );
      expect(out.results.slack).toEqual({
        status: "ok",
        message: "#atlas (new) · 2 invited · 3 announced · 1 no Slack account",
      });
    });

    it("a mentor-role override beats the P3 default for the (mentor) tag", async () => {
      prismaMock.staffingMentorRole.findMany.mockResolvedValue([
        { userId: "u-grace", isMentor: false },
        { userId: "u-ada", isMentor: true },
      ]);
      await run({ automations: ["slack"] });
      const text = vi.mocked(postMessage).mock.calls[0][1] as string;
      expect(text).toContain("• Ada Lovelace (mentor)\n• Grace Hopper");
      expect(text).not.toContain("Grace Hopper (mentor)");
    });

    it("reuses the cached channel when the name is unchanged", async () => {
      project.slackChannelId = "C9";
      project.slackChannelName = "atlas-chan";
      await run({ automations: ["slack"] });
      expect(ensureChannel).not.toHaveBeenCalled();
      expect(prismaMock.project.update).not.toHaveBeenCalled();
      expect(inviteUsersToChannel).toHaveBeenCalledWith("C9", ["S1", "S2"]);
    });

    it("re-ensures the channel when the modal name differs from the cached one", async () => {
      project.slackChannelId = "C9";
      project.slackChannelName = "old";
      vi.mocked(ensureChannel).mockResolvedValue({ id: "C2", name: "newer", created: false } as never);
      const out = (await run({ automations: ["slack"], slackChannel: " newer " })) as {
        results: Record<string, { message: string }>;
      };
      expect(ensureChannel).toHaveBeenCalledWith("newer");
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: PROJECT.id },
        data: { slackChannelId: "C2", slackChannelName: "newer" },
      });
      expect(out.results.slack.message.startsWith("#newer · ")).toBe(true);
    });

    it("announces a placeholder when nobody is confirmed", async () => {
      prismaMock.staffingAssignment.findMany.mockResolvedValue([]);
      prismaMock.externalMentor.findMany.mockResolvedValue([]);
      await run({ automations: ["slack"] });
      expect(vi.mocked(postMessage).mock.calls[0][1]).toContain("_No confirmed members yet._");
    });

    it("invites roster, term core members and admins", async () => {
      prismaMock.coreAssignment.findMany.mockResolvedValue([{ user: user("u-core", "Core", "Person") }]);
      prismaMock.adminMembership.findMany.mockResolvedValue([{ user: user("u-admin", "Admin", "Person") }]);
      await run({ automations: ["slack"] });
      expect(prismaMock.coreAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { termId: CYCLE.termId } }),
      );
      const ids = (vi.mocked(resolveSlackIdsForInvite).mock.calls[0][0] as { id: string }[]).map((u) => u.id);
      expect(ids).toEqual(["u-grace", "u-ada", "u-bob", "u-core", "u-admin"]);
    });

    it("converts a Slack failure into an error result", async () => {
      vi.mocked(ensureChannel).mockRejectedValue(new Error("name_taken"));
      const out = (await run({ automations: ["slack"] })) as { results: Record<string, unknown> };
      expect(out.results.slack).toEqual({ status: "error", message: "name_taken" });
    });
  });
});

describe("gmail step", () => {
  const confirmed = (daliEmail: string | null, first: string, last: string) => ({
    user: { firstName: first, lastName: last, daliEmail },
  });

  it("is skipped off-prod", async () => {
    vi.mocked(externalFinalizeAllowed).mockReturnValue(false);
    const out = (await run({ automations: ["gmail"] })) as { results: Record<string, unknown> };
    expect(out.results.gmail).toEqual({ status: "skipped", message: "skipped non-prod" });
  });

  it("is skipped when Workspace is not configured", async () => {
    vi.mocked(workspaceConfigured).mockReturnValue(false);
    const out = (await run({ automations: ["gmail"] })) as { results: Record<string, { status: string }> };
    expect(out.results.gmail.status).toBe("skipped");
    expect(ensureWorkspaceGroup).not.toHaveBeenCalled();
  });

  describe("when configured", () => {
    beforeEach(() => {
      vi.mocked(workspaceConfigured).mockReturnValue(true);
      vi.mocked(ensureWorkspaceGroup).mockResolvedValue({
        status: "ok",
        email: "derived-team@example.edu",
        created: true,
      } as never);
      vi.mocked(addGroupMember).mockResolvedValue({ status: "ok", added: true } as never);
    });

    it("creates the group from the derived address, caches it, and adds distinct DALI emails", async () => {
      prismaMock.staffingAssignment.findMany.mockResolvedValue([
        confirmed("ada@example.edu", "Ada", "Lovelace"),
        confirmed("ada@example.edu", "Ada", "Lovelace"),
        confirmed(" grace@example.edu ", "Grace", "Hopper"),
        confirmed(null, "Bob", "Zed"),
      ]);
      const out = (await run({ automations: ["gmail"] })) as { results: Record<string, { status: string; message: string }> };

      expect(ensureWorkspaceGroup).toHaveBeenCalledWith({ email: "derived-team@example.edu", name: "Atlas Team" });
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: PROJECT.id },
        data: { teamGroupEmail: "derived-team@example.edu" },
      });
      expect(addGroupMember).toHaveBeenCalledTimes(2);
      expect(addGroupMember).toHaveBeenCalledWith({ groupEmail: "derived-team@example.edu", memberEmail: "grace@example.edu" });
      expect(out.results.gmail).toEqual({
        status: "ok",
        message: "derived-team@example.edu (new) · 2 added · 1 no DALI email: Bob Zed",
      });
    });

    it("uses the stored group address and does not re-persist it", async () => {
      project.teamGroupEmail = " stored@example.edu ";
      vi.mocked(ensureWorkspaceGroup).mockResolvedValue({ status: "ok", email: "stored@example.edu", created: false } as never);
      await run({ automations: ["gmail"] });
      expect(ensureWorkspaceGroup).toHaveBeenCalledWith({ email: "stored@example.edu", name: "Atlas Team" });
      expect(prismaMock.project.update).not.toHaveBeenCalled();
    });

    it("counts already-present members and marks the step error when any add fails", async () => {
      prismaMock.staffingAssignment.findMany.mockResolvedValue([
        confirmed("a@example.edu", "A", "A"),
        confirmed("b@example.edu", "B", "B"),
        confirmed("c@example.edu", "C", "C"),
      ]);
      vi.mocked(addGroupMember)
        .mockResolvedValueOnce({ status: "ok", added: true } as never)
        .mockResolvedValueOnce({ status: "ok", added: false } as never)
        .mockResolvedValueOnce({ status: "error", message: "quota" } as never);
      const out = (await run({ automations: ["gmail"] })) as { results: Record<string, { status: string; message: string }> };
      expect(out.results.gmail.status).toBe("error");
      expect(out.results.gmail.message).toBe(
        "derived-team@example.edu (new) · 1 added · 1 already in · failed: c@example.edu: quota",
      );
    });

    it("reports a group error without touching members", async () => {
      vi.mocked(ensureWorkspaceGroup).mockResolvedValue({ status: "error", message: "denied" } as never);
      const out = (await run({ automations: ["gmail"] })) as { results: Record<string, unknown> };
      expect(out.results.gmail).toEqual({ status: "error", message: "Group: denied" });
      expect(addGroupMember).not.toHaveBeenCalled();
    });
  });
});

describe("github step", () => {
  const member = (handle: string | null, first: string, last: string) => ({
    user: { firstName: first, lastName: last, githubUsername: handle },
  });
  const OLD_ENV = process.env.GITHUB_ORG;

  beforeEach(() => {
    process.env.GITHUB_ORG = "example-org";
    project.githubTeamSlug = "atlas";
    vi.mocked(ensureTeam).mockResolvedValue({ slug: "atlas", created: false } as never);
    vi.mocked(addTeamMember).mockResolvedValue(undefined as never);
  });
  afterAll(() => {
    if (OLD_ENV === undefined) delete process.env.GITHUB_ORG;
    else process.env.GITHUB_ORG = OLD_ENV;
  });

  const gh = async (body: Partial<Parameters<typeof finalizeStaffing>[1]> = {}) =>
    ((await run({ automations: ["github"], ...body })) as { results: Record<string, { status: string; message: string }> }).results.github;

  it("is skipped off-prod", async () => {
    vi.mocked(externalFinalizeAllowed).mockReturnValue(false);
    expect(await gh()).toEqual({ status: "skipped", message: "skipped non-prod" });
  });

  it("is skipped without GITHUB_ORG", async () => {
    delete process.env.GITHUB_ORG;
    expect(await gh()).toEqual({ status: "skipped", message: "GITHUB_ORG not set." });
  });

  it("is skipped with no slug anywhere", async () => {
    project.githubTeamSlug = null;
    expect(await gh()).toEqual({ status: "skipped", message: "No team slug set." });
  });

  it("is skipped when another project owns the slug (case-insensitive check)", async () => {
    prismaMock.project.count.mockResolvedValue(1);
    const r = await gh();
    expect(prismaMock.project.count).toHaveBeenCalledWith({
      where: { id: { not: PROJECT.id }, githubTeamSlug: { equals: "atlas", mode: "insensitive" } },
    });
    expect(r.status).toBe("skipped");
    expect(r.message).toContain('Slug "atlas" belongs to another project');
    expect(ensureTeam).not.toHaveBeenCalled();
  });

  it("adds distinct handles, reports missing handles, and grants repos", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([
      member("ada-l", "Ada", "Lovelace"),
      member("ada-l", "Ada", "Lovelace"),
      member(null, "Bob", "Zed"),
    ]);
    project.repoUrls = ["a", "b"];
    vi.mocked(grantTeamRepos).mockResolvedValue([
      { repo: "a", status: "granted" },
      { repo: "b", status: "granted" },
    ] as never);
    const r = await gh();
    expect(addTeamMember).toHaveBeenCalledTimes(1);
    expect(addTeamMember).toHaveBeenCalledWith("atlas", "ada-l");
    expect(grantTeamRepos).toHaveBeenCalledWith("atlas", ["a", "b"]);
    expect(r).toEqual({
      status: "ok",
      message: "atlas · 1 added · 2 repos granted · 1 no GitHub username: Bob Zed",
    });
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });

  it("isolates per-member failures: 2FA is reported separately and does not abort the rest", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([
      member("a", "Ada", "Lovelace"),
      member("b", "Grace", "Hopper"),
      member("c", "Bob", "Zed"),
    ]);
    vi.mocked(addTeamMember)
      .mockRejectedValueOnce(new Error("no2fa"))
      .mockRejectedValueOnce(new Error("dead handle"))
      .mockResolvedValueOnce(undefined as never);
    const r = await gh();
    expect(addTeamMember).toHaveBeenCalledTimes(3);
    expect(r.status).toBe("error");
    expect(r.message).toContain("1 added");
    expect(r.message).toContain("1 must enable two-factor auth on GitHub before they can join: Ada Lovelace");
    expect(r.message).toContain("1 failed — Grace Hopper: dead handle");
  });

  it("a 2FA-only miss is not an error, but a repo grant error is", async () => {
    prismaMock.staffingAssignment.findMany.mockResolvedValue([member("a", "Ada", "Lovelace")]);
    vi.mocked(addTeamMember).mockRejectedValueOnce(new Error("no2fa"));
    expect((await gh()).status).toBe("ok");

    vi.mocked(addTeamMember).mockResolvedValue(undefined as never);
    vi.mocked(grantTeamRepos).mockResolvedValue([{ repo: "a", status: "error", message: "403" }] as never);
    const r = await gh();
    expect(r.status).toBe("error");
    expect(r.message).toContain("1 repo error: 403");
  });

  it("persists a slug changed in the modal and creates the team under it", async () => {
    vi.mocked(ensureTeam).mockResolvedValue({ slug: "atlas-2", created: true } as never);
    const r = await gh({ githubTeamSlug: " atlas-2 " });
    expect(ensureTeam).toHaveBeenCalledWith("atlas-2");
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT.id },
      data: { githubTeamSlug: "atlas-2" },
    });
    expect(r.message.startsWith("atlas-2 (new)")).toBe(true);
  });

  it("converts a GitHub failure into an error result", async () => {
    vi.mocked(ensureTeam).mockRejectedValue(new Error("rate limited"));
    expect(await gh()).toEqual({ status: "error", message: "rate limited" });
  });
});
