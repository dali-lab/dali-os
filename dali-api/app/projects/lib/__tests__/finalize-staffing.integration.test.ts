import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/slack/lib/slack-client", () => ({
  postMessage: vi.fn(),
  ensureChannel: vi.fn(),
  inviteUsersToChannel: vi.fn(),
  slackErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  slackConfigured: vi.fn(() => false),
  SLACK_NOT_CONFIGURED_MESSAGE: "slack not configured",
}));
vi.mock("~/slack/lib/slack-sync.server", () => ({ resolveSlackIdsForInvite: vi.fn() }));
vi.mock("~/lib/github", () => ({ ensureTeam: vi.fn(), addTeamMember: vi.fn(), isNo2fa: () => false }));
vi.mock("~/lib/google-workspace", () => ({
  workspaceConfigured: vi.fn(() => false),
  deriveProjectEmails: vi.fn(),
  ensureWorkspaceGroup: vi.fn(),
  addGroupMember: vi.fn(),
}));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn(async () => ({ inApp: 0, emailed: 0, slackDmed: 0 })) }));
vi.mock("~/lib/promotion-notify.server", () => ({
  notifyAdminsOfPromotion: vi.fn(async () => undefined),
  isLevelAdvance: () => false,
}));
vi.mock("../staffing-events.server", () => ({ publishCycleChange: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { finalizeStaffing } from "../finalize-staffing.server";

const request = new Request("http://localhost/");

async function seed() {
  const term = await prisma.term.create({
    data: { code: "26F", year: 2026, season: "F", sortKey: 20264, startDate: new Date("2026-09-15"), endDate: new Date("2026-11-30") },
  });
  const cycle = await prisma.staffingCycle.create({ data: { termId: term.id, name: "Fall 2026" } });
  const project = await prisma.project.create({ data: { name: "Atlas" } });
  const other = await prisma.project.create({ data: { name: "Beacon" } });
  const domain = await prisma.domain.create({ data: { name: "Engineering", code: "ENG", displayName: "Engineering" } });
  const actor = await prisma.user.create({ data: { firstName: "Grace", lastName: "Hopper" } });
  const ada = await prisma.user.create({ data: { firstName: "Ada", lastName: "Lovelace" } });
  const alan = await prisma.user.create({ data: { firstName: "Alan", lastName: "Turing" } });
  return { term, cycle, project, other, domain, actor, ada, alan };
}

type Seed = Awaited<ReturnType<typeof seed>>;

const propose = (s: Seed, userId: string, level: "P1" | "P2" | "P3", status: "Proposed" | "Confirmed" = "Proposed", projectId = s.project.id) =>
  prisma.staffingAssignment.create({
    data: { userId, staffingCycleId: s.cycle.id, projectId, termId: s.term.id, domainId: s.domain.id, level, status },
  });

const run = (s: Seed) =>
  finalizeStaffing(s.actor.id, { cycleId: s.cycle.id, projectId: s.project.id, automations: ["assignments"] }, request);

afterEach(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_elig ON "DomainEligibility"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_elig_fn()`);
});

describe("finalizeStaffing assignments step (real database)", () => {
  it("confirms proposed rows and writes ProjectAssignment + DomainEligibility under their composite keys", async () => {
    const s = await seed();
    await propose(s, s.ada.id, "P2");
    await propose(s, s.alan.id, "P1");

    const out = await run(s);

    expect(out).toMatchObject({ results: { assignments: { status: "ok" } } });
    expect(await prisma.staffingAssignment.count({ where: { status: "Confirmed" } })).toBe(2);
    const pa = await prisma.projectAssignment.findMany({ orderBy: { level: "asc" } });
    expect(pa.map((r) => [r.userId, r.projectId, r.termId, r.domainId, r.level])).toEqual([
      [s.alan.id, s.project.id, s.term.id, s.domain.id, "P1"],
      [s.ada.id, s.project.id, s.term.id, s.domain.id, "P2"],
    ]);
    const elig = await prisma.domainEligibility.findUnique({
      where: { userId_domainId: { userId: s.ada.id, domainId: s.domain.id } },
    });
    expect(elig).toMatchObject({ level: "P2", promotedBy: s.actor.id });
  });

  it("updates an existing ProjectAssignment and eligibility instead of duplicating them", async () => {
    const s = await seed();
    await prisma.projectAssignment.create({
      data: { userId: s.ada.id, projectId: s.project.id, termId: s.term.id, domainId: s.domain.id, level: "P1" },
    });
    await prisma.domainEligibility.create({ data: { userId: s.ada.id, domainId: s.domain.id, level: "P1" } });
    await propose(s, s.ada.id, "P3");

    await run(s);

    const pa = await prisma.projectAssignment.findMany();
    expect(pa).toHaveLength(1);
    expect(pa[0].level).toBe("P3");
    const elig = await prisma.domainEligibility.findMany();
    expect(elig).toHaveLength(1);
    expect(elig[0].level).toBe("P3");
  });

  it("is idempotent: a second run changes nothing and creates no duplicate rows", async () => {
    const s = await seed();
    await propose(s, s.ada.id, "P2");
    await run(s);
    const snapshot = async () => ({
      sa: await prisma.staffingAssignment.findMany({ orderBy: { id: "asc" } }),
      pa: await prisma.projectAssignment.findMany({ orderBy: { id: "asc" } }),
      el: await prisma.domainEligibility.findMany({ orderBy: { id: "asc" } }),
    });
    const first = await snapshot();

    const again = await run(s);
    const second = await snapshot();

    expect(again).toMatchObject({ results: { assignments: { status: "ok" } } });
    expect(second.sa).toHaveLength(1);
    expect(second.pa).toEqual(first.pa);
    expect(second.sa.map((r) => [r.id, r.status])).toEqual(first.sa.map((r) => [r.id, r.status]));
    expect(second.el.map((r) => [r.id, r.level])).toEqual(first.el.map((r) => [r.id, r.level]));
  });

  it("declines a confirmed row dropped by a re-edit and deletes its assignment", async () => {
    const s = await seed();
    const design = await prisma.domain.create({ data: { name: "Design", code: "DES", displayName: "Design" } });
    await propose(s, s.ada.id, "P2", "Confirmed");
    await prisma.projectAssignment.create({
      data: { userId: s.ada.id, projectId: s.project.id, termId: s.term.id, domainId: s.domain.id, level: "P2" },
    });
    // Re-edit: Ada moves to Design, so the confirmed Engineering row is no longer live.
    await prisma.staffingAssignment.create({
      data: {
        userId: s.ada.id, staffingCycleId: s.cycle.id, projectId: s.project.id, termId: s.term.id,
        domainId: design.id, level: "P2", status: "Proposed",
      },
    });
    await propose(s, s.alan.id, "P1");

    const out = await run(s);

    expect(out).toMatchObject({ results: { assignments: { message: expect.stringContaining("1 removed") } } });
    const old = await prisma.staffingAssignment.findFirstOrThrow({
      where: { userId: s.ada.id, domainId: s.domain.id },
    });
    expect(old.status).toBe("Declined");
    const adaPa = await prisma.projectAssignment.findMany({ where: { userId: s.ada.id } });
    expect(adaPa.map((r) => r.domainId)).toEqual([design.id]);
    expect(await prisma.projectAssignment.count({ where: { userId: s.alan.id } })).toBe(1);
  });

  it("leaves no partial writes when the transaction fails midway", async () => {
    const s = await seed();
    await propose(s, s.ada.id, "P2");
    await propose(s, s.alan.id, "P1");
    // Fail eligibility for whichever member is processed second, after earlier writes landed.
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_elig_fn() RETURNS trigger AS $$
      BEGIN
        IF NEW."userId" = '${s.alan.id}' THEN RAISE EXCEPTION 'forced failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_elig BEFORE INSERT OR UPDATE ON "DomainEligibility" FOR EACH ROW EXECUTE FUNCTION fail_elig_fn()`,
    );

    const out = await run(s);

    expect(out).toMatchObject({ results: { assignments: { status: "error" } } });
    expect(await prisma.staffingAssignment.count({ where: { status: "Proposed" } })).toBe(2);
    expect(await prisma.staffingAssignment.count({ where: { status: "Confirmed" } })).toBe(0);
    expect(await prisma.projectAssignment.count()).toBe(0);
    expect(await prisma.domainEligibility.count()).toBe(0);
  });
});
