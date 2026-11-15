import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  applyContinue,
  applyMaintain,
  applyNotContinuing,
  applyUndecided,
  loadRenewalCards,
  setMaintenancePlan,
} from "../partner-renewals.server";

const CODES = [
  ["26F", 20264],
  ["27W", 20271],
  ["27S", 20272],
  ["27X", 20273],
] as const;

async function seed() {
  const terms: Record<string, { id: string; code: string; sortKey: number }> = {};
  for (const [code, sortKey] of CODES) {
    const t = await prisma.term.create({
      data: {
        code,
        year: 2026,
        season: code.slice(-1) as "W" | "S" | "X" | "F",
        sortKey,
        startDate: new Date(Date.UTC(2026, 0, sortKey % 100)),
        endDate: new Date(Date.UTC(2026, 1, sortKey % 100)),
      },
    });
    terms[code] = { id: t.id, code, sortKey };
  }
  const user = await prisma.user.create({ data: { firstName: "Grace", lastName: "Hopper" } });
  const eng = await prisma.domain.create({ data: { name: "Engineering", code: "ENG", displayName: "Engineering" } });
  const project = await prisma.project.create({ data: { name: "Smart Microscope" } });
  await prisma.projectTerm.create({ data: { projectId: project.id, termId: terms["26F"].id } });
  return { terms, user, eng, project };
}

type Seed = Awaited<ReturnType<typeof seed>>;

const continueFrom = (s: Seed, code: string) =>
  applyContinue(prisma, {
    projectId: s.project.id,
    decisionTermId: s.terms["27W"].id,
    chosenTermId: s.terms[code].id,
    feeCents: null,
    roles: [{ domainId: s.eng.id, slots: 3 }],
    userId: s.user.id,
  });

async function card(s: Seed) {
  const all = Object.values(s.terms);
  const { cards } = await loadRenewalCards(s.terms["26F"], all);
  return cards.find((c) => c.projectId === s.project.id)!;
}

async function termState(s: Seed, code: string) {
  const termId = s.terms[code].id;
  const [projectTerm, status, spots] = await Promise.all([
    prisma.projectTerm.findUnique({ where: { projectId_termId: { projectId: s.project.id, termId } } }),
    prisma.projectTermStatus.findUnique({ where: { projectId_termId: { projectId: s.project.id, termId } } }),
    prisma.projectRoleRequest.count({ where: { projectId: s.project.id, termId } }),
  ]);
  return { projectTerm: !!projectTerm, continuing: status?.isContinuing ?? null, spots };
}

describe("renewals with a skipped term", () => {
  it("moves the return term when a skip is changed to a later term", async () => {
    const s = await seed();
    await continueFrom(s, "27S");
    await continueFrom(s, "27X");

    expect(await card(s)).toMatchObject({ column: "continuing", fromTermCode: "27X" });
    expect(await termState(s, "27S")).toEqual({ projectTerm: false, continuing: null, spots: 0 });
    expect(await termState(s, "27X")).toEqual({ projectTerm: true, continuing: true, spots: 1 });
  });

  it("drops the return term when a skip is changed to continuing next term", async () => {
    const s = await seed();
    await continueFrom(s, "27S");
    await continueFrom(s, "27W");

    expect(await card(s)).toMatchObject({ column: "continuing", fromTermCode: null });
    expect(await termState(s, "27S")).toEqual({ projectTerm: false, continuing: null, spots: 0 });
  });

  it("drops the return term when a skip is changed to not continuing", async () => {
    const s = await seed();
    await continueFrom(s, "27S");
    await applyNotContinuing(prisma, {
      projectId: s.project.id,
      decisionTermId: s.terms["27W"].id,
      reason: "No funding",
      userId: s.user.id,
    });

    expect(await card(s)).toMatchObject({ column: "not_continuing" });
    expect(await termState(s, "27S")).toEqual({ projectTerm: false, continuing: null, spots: 0 });
  });

  it("drops the return term when a skip is moved back to undecided", async () => {
    const s = await seed();
    await continueFrom(s, "27S");
    await applyUndecided(prisma, { projectId: s.project.id, decisionTermId: s.terms["27W"].id, userId: s.user.id });

    expect(await card(s)).toMatchObject({ column: "undecided" });
    expect(await termState(s, "27S")).toEqual({ projectTerm: false, continuing: null, spots: 0 });
  });

  it("drops next term when a plain continue is moved back to undecided", async () => {
    const s = await seed();
    await continueFrom(s, "27W");
    await applyUndecided(prisma, { projectId: s.project.id, decisionTermId: s.terms["27W"].id, userId: s.user.id });

    expect(await card(s)).toMatchObject({ column: "undecided" });
    expect(await termState(s, "27W")).toEqual({ projectTerm: false, continuing: null, spots: 0 });
  });

  it("keeps a return term people are already staffed on", async () => {
    const s = await seed();
    await continueFrom(s, "27S");
    await prisma.projectAssignment.create({
      data: { userId: s.user.id, projectId: s.project.id, termId: s.terms["27S"].id, domainId: s.eng.id, level: "P1" },
    });
    await continueFrom(s, "27X");

    expect(await termState(s, "27S")).toMatchObject({ projectTerm: true, spots: 1 });
  });

  it("keeps a return term that has a PI set, while clearing its continuing mark and spots", async () => {
    const s = await seed();
    await continueFrom(s, "27S");
    await prisma.projectTerm.update({
      where: { projectId_termId: { projectId: s.project.id, termId: s.terms["27S"].id } },
      data: { piUserId: s.user.id },
    });
    await continueFrom(s, "27X");

    expect(await termState(s, "27S")).toEqual({ projectTerm: true, continuing: null, spots: 0 });
  });

  it("leaves later planned terms alone when the decision was never a skip", async () => {
    const s = await seed();
    await prisma.projectTerm.create({ data: { projectId: s.project.id, termId: s.terms["27S"].id } });
    await prisma.projectTermStatus.create({
      data: { projectId: s.project.id, termId: s.terms["27S"].id, isContinuing: true },
    });
    await continueFrom(s, "27W");
    await applyNotContinuing(prisma, {
      projectId: s.project.id,
      decisionTermId: s.terms["27W"].id,
      reason: "Changed plans",
      userId: s.user.id,
    });

    expect(await termState(s, "27S")).toEqual({ projectTerm: true, continuing: true, spots: 0 });
  });
});

describe("renewals: stopping a continue", () => {
  it("drops next term when a plain continue becomes not continuing", async () => {
    const s = await seed();
    await continueFrom(s, "27W");
    await applyNotContinuing(prisma, {
      projectId: s.project.id,
      decisionTermId: s.terms["27W"].id,
      reason: "Funding fell through",
      userId: s.user.id,
    });
    expect(await card(s)).toMatchObject({ column: "not_continuing" });
    expect(await termState(s, "27W")).toEqual({ projectTerm: false, continuing: false, spots: 0 });
  });
});

describe("renewals: maintenance plans", () => {
  const maintain = (s: Seed, plan: "Hosting" | "Mild" | "Medium", feeCents: number | null = 50000) =>
    applyMaintain(prisma, {
      projectId: s.project.id,
      decisionTermId: s.terms["27W"].id,
      plan,
      feeCents,
      userId: s.user.id,
    });
  const openPlans = (s: Seed) =>
    prisma.projectMaintenance.findMany({ where: { projectId: s.project.id, endedAt: null } });

  it("puts the project on a plan starting next term and out of term planning", async () => {
    const s = await seed();
    await maintain(s, "Mild", 150000);
    expect(await card(s)).toMatchObject({
      column: "maintaining",
      maintenance: { plan: "Mild", feeCents: 150000, startTermCode: "27W" },
    });
    expect(await termState(s, "27W")).toEqual({ projectTerm: false, continuing: false, spots: 0 });
    expect(await openPlans(s)).toHaveLength(1);
  });

  it("undoes a planned continue when the project moves to maintenance", async () => {
    const s = await seed();
    await continueFrom(s, "27W");
    await maintain(s, "Hosting");
    expect(await termState(s, "27W")).toEqual({ projectTerm: false, continuing: false, spots: 0 });
  });

  it("switches the tier on the same plan instead of opening a second one", async () => {
    const s = await seed();
    await maintain(s, "Hosting", 20000);
    await maintain(s, "Medium", 300000);
    const plans = await openPlans(s);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ plan: "Medium", feeCents: 300000 });
  });

  it("ends the plan when the project continues again, keeping its history", async () => {
    const s = await seed();
    await maintain(s, "Mild");
    await continueFrom(s, "27W");
    expect(await card(s)).toMatchObject({ column: "continuing", maintenance: null });
    expect(await openPlans(s)).toEqual([]);
    const ended = await prisma.projectMaintenance.findMany({ where: { projectId: s.project.id } });
    expect(ended).toHaveLength(1);
    expect(ended[0].endedAt).not.toBeNull();
    expect(ended[0].endedById).toBe(s.user.id);
  });

  it("ends the plan when moved to not continuing or undecided", async () => {
    const s = await seed();
    await maintain(s, "Mild");
    await applyNotContinuing(prisma, {
      projectId: s.project.id,
      decisionTermId: s.terms["27W"].id,
      reason: "Partner shut down",
      userId: s.user.id,
    });
    expect(await openPlans(s)).toEqual([]);
    await maintain(s, "Mild");
    await applyUndecided(prisma, { projectId: s.project.id, decisionTermId: s.terms["27W"].id, userId: s.user.id });
    expect(await openPlans(s)).toEqual([]);
    expect(await card(s)).toMatchObject({ column: "undecided" });
  });

  it("keeps a maintained project on the board in later terms it isn't active in", async () => {
    const s = await seed();
    await maintain(s, "Hosting");
    const all = Object.values(s.terms);
    const { cards } = await loadRenewalCards(s.terms["27S"], all);
    expect(cards.map((c) => [c.projectId, c.column])).toEqual([[s.project.id, "maintaining"]]);
  });

  it("changes the tier from planning with the tier's price, or keeps the fee when no price is set", async () => {
    const s = await seed();
    await maintain(s, "Hosting", 20000);
    expect(await setMaintenancePlan(prisma, { projectId: s.project.id, plan: "Mild" })).toBe("ok");
    expect((await openPlans(s))[0]).toMatchObject({ plan: "Mild", feeCents: 20000 });
    await prisma.partnerCrmSettings.create({ data: { id: "default", maintenanceMediumCents: 300000 } });
    await setMaintenancePlan(prisma, { projectId: s.project.id, plan: "Medium" });
    expect((await openPlans(s))[0]).toMatchObject({ plan: "Medium", feeCents: 300000 });
  });

  it("refuses to change the tier of a project that is not on a plan", async () => {
    const s = await seed();
    expect(await setMaintenancePlan(prisma, { projectId: s.project.id, plan: "Mild" })).toBe("not-on-plan");
  });
});
