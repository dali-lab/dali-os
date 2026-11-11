import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { listReturnableProjects, reopenProjectFromApplication, startProjectReturn } from "../partner-returns.server";

async function term(code: string, sortKey: number) {
  return prisma.term.create({
    data: {
      code,
      year: 2000 + Math.floor(sortKey / 10),
      season: code.slice(-1) as "W" | "S" | "X" | "F",
      sortKey,
      startDate: new Date(Date.UTC(2026, 0, sortKey % 300)),
      endDate: new Date(Date.UTC(2026, 1, sortKey % 300)),
    },
  });
}

async function seed() {
  const t26s = await term("26S", 20262);
  const t26f = await term("26F", 20264);
  const t27w = await term("27W", 20271);
  const t27s = await term("27S", 20272);
  const actor = await prisma.user.create({ data: { firstName: "Grace", lastName: "Hopper" } });
  const eng = await prisma.domain.create({ data: { name: "Engineering", code: "ENG", displayName: "Engineering" } });
  const des = await prisma.domain.create({ data: { name: "Design", code: "DES", displayName: "Design" } });

  const contact = await prisma.partnerContact.create({ data: { name: "Pat Partner", email: "pat@example.org" } });
  const other = await prisma.partnerContact.create({ data: { name: "Sam Second", email: "sam@example.org" } });
  const org = await prisma.partnerOrg.create({ data: { name: "Research Computing" } });
  await prisma.partnerMembership.create({ data: { contactId: other.id, orgId: org.id } });
  const primary = await prisma.partnerMembership.create({ data: { contactId: contact.id, orgId: org.id } });
  await prisma.partnerOrg.update({ where: { id: org.id }, data: { primaryContactId: primary.id } });

  const past = await prisma.project.create({ data: { name: "Research Computing Dashboard", status: "Archived" } });
  await prisma.projectTerm.create({ data: { projectId: past.id, termId: t26s.id } });
  await prisma.projectPartner.create({
    data: { projectId: past.id, partnerOrgId: org.id, startedAt: new Date("2026-03-30"), endedAt: new Date("2026-06-09") },
  });
  await prisma.projectRoleRequest.createMany({
    data: [
      { projectId: past.id, termId: t26s.id, domainId: eng.id, level: "P1", slots: 2 },
      { projectId: past.id, termId: t26s.id, domainId: eng.id, level: "P3", slots: 1 },
      { projectId: past.id, termId: t26s.id, domainId: des.id, level: "P1", slots: 1 },
    ],
  });

  const running = await prisma.project.create({ data: { name: "Evergreen" } });
  await prisma.projectTerm.create({ data: { projectId: running.id, termId: t27w.id } });

  return { t26s, t26f, t27w, t27s, actor, eng, des, contact, org, past, running };
}

describe("listReturnableProjects", () => {
  it("lists projects whose last term is before the planned term, with that term", async () => {
    const { past } = await seed();
    await prisma.project.create({ data: { name: "No terms yet" } });
    expect(await listReturnableProjects(20271)).toEqual([
      { id: past.id, name: "Research Computing Dashboard", lastTermCode: "26S" },
    ]);
  });
});

describe("startProjectReturn", () => {
  it("opens a return carrying the partner org, primary contact and last term's spots", async () => {
    const { past, org, contact, actor, t27w, eng, des } = await seed();
    const result = await startProjectReturn({ projectId: past.id, targetTermIds: [t27w.id], actorUserId: actor.id });
    expect(result.ok).toBe(true);
    const app = await prisma.partnerApplication.findUniqueOrThrow({
      where: { id: (result as { applicationId: string }).applicationId },
      include: { targetTerms: true, domains: true },
    });
    expect(app).toMatchObject({
      title: "Research Computing Dashboard",
      stage: "New",
      source: "Renewal",
      partnerOrgId: org.id,
      applicantContactId: contact.id,
      continuesProjectId: past.id,
      resultingProjectId: null,
    });
    expect(app.targetTerms.map((t) => t.termId)).toEqual([t27w.id]);
    expect(app.domains.map((d) => [d.domainId, d.expectedMembers]).sort()).toEqual(
      [
        [eng.id, 3],
        [des.id, 1],
      ].sort(),
    );
  });

  it("refuses a second open return for the same project", async () => {
    const { past, actor, t27w } = await seed();
    await startProjectReturn({ projectId: past.id, targetTermIds: [t27w.id], actorUserId: actor.id });
    expect(await startProjectReturn({ projectId: past.id, targetTermIds: [t27w.id], actorUserId: actor.id })).toEqual({
      ok: false,
      error: "already-open",
    });
  });

  it("refuses a project with no partner contact, no terms, or no project", async () => {
    const { actor, t27w, past } = await seed();
    const lonely = await prisma.project.create({ data: { name: "Internal tool" } });
    expect(await startProjectReturn({ projectId: lonely.id, targetTermIds: [t27w.id], actorUserId: actor.id })).toEqual({
      ok: false,
      error: "no-contact",
    });
    expect(await startProjectReturn({ projectId: past.id, targetTermIds: [], actorUserId: actor.id })).toEqual({
      ok: false,
      error: "no-terms",
    });
    expect(await startProjectReturn({ projectId: "gone", targetTermIds: [t27w.id], actorUserId: actor.id })).toEqual({
      ok: false,
      error: "not-found",
    });
    expect(await prisma.partnerApplication.count()).toBe(0);
  });
});

describe("startProjectReturn contact fallback", () => {
  it("skips a linked org with no members and uses the next one that has a contact", async () => {
    const { actor, t27w, contact } = await seed();
    const empty = await prisma.partnerOrg.create({ data: { name: "Thayer School of Engineering" } });
    const staffed = await prisma.partnerOrg.create({ data: { name: "Prof. Balkcom" } });
    await prisma.partnerMembership.create({ data: { contactId: contact.id, orgId: staffed.id } });
    const project = await prisma.project.create({ data: { name: "Robotic Arm" } });
    const s = await prisma.term.findFirstOrThrow({ where: { code: "26S" } });
    await prisma.projectTerm.create({ data: { projectId: project.id, termId: s.id } });
    await prisma.projectPartner.create({ data: { projectId: project.id, partnerOrgId: empty.id, startedAt: new Date("2026-04-01") } });
    await prisma.projectPartner.create({ data: { projectId: project.id, partnerOrgId: staffed.id, startedAt: new Date("2026-03-01") } });

    const r = await startProjectReturn({ projectId: project.id, targetTermIds: [t27w.id], actorUserId: actor.id });
    const app = await prisma.partnerApplication.findUniqueOrThrow({ where: { id: (r as { applicationId: string }).applicationId } });
    expect(app).toMatchObject({ partnerOrgId: staffed.id, applicantContactId: contact.id });
  });

  it("falls back to whoever applied for the project when no org has a member", async () => {
    const { actor, t27w } = await seed();
    const applicant = await prisma.partnerContact.create({ data: { name: "Ada Applicant", email: "ada@example.org" } });
    const orgNoMembers = await prisma.partnerOrg.create({ data: { name: "Hood Museum" } });
    const project = await prisma.project.create({ data: { name: "Hood AR" } });
    const s = await prisma.term.findFirstOrThrow({ where: { code: "26S" } });
    await prisma.projectTerm.create({ data: { projectId: project.id, termId: s.id } });
    await prisma.projectPartner.create({ data: { projectId: project.id, partnerOrgId: orgNoMembers.id } });
    await prisma.partnerApplication.create({
      data: { title: "Hood AR", applicantContactId: applicant.id, stage: "Accepted", resultingProjectId: project.id },
    });

    const r = await startProjectReturn({ projectId: project.id, targetTermIds: [t27w.id], actorUserId: actor.id });
    const app = await prisma.partnerApplication.findUniqueOrThrow({ where: { id: (r as { applicationId: string }).applicationId } });
    expect(app).toMatchObject({ applicantContactId: applicant.id, partnerOrgId: orgNoMembers.id, continuesProjectId: project.id });
  });
});

describe("reopenProjectFromApplication", () => {
  async function returnApp(s: Awaited<ReturnType<typeof seed>>, termIds: string[]) {
    const r = await startProjectReturn({ projectId: s.past.id, targetTermIds: termIds, actorUserId: s.actor.id });
    const app = await prisma.partnerApplication.findUniqueOrThrow({
      where: { id: (r as { applicationId: string }).applicationId },
      include: { targetTerms: true, domains: true },
    });
    return {
      id: app.id,
      continuesProjectId: s.past.id,
      partnerOrgId: app.partnerOrgId,
      piUserId: null,
      targetTermIds: app.targetTerms.map((t) => t.termId),
      domains: app.domains.map((d) => ({ domainId: d.domainId, expectedMembers: d.expectedMembers })),
    };
  }

  it("reopens the same project for the target terms instead of creating one", async () => {
    const s = await seed();
    const app = await returnApp(s, [s.t27w.id, s.t27s.id]);
    await prisma.projectRoleRequest.create({
      data: { projectId: s.past.id, termId: s.t27s.id, domainId: s.eng.id, level: "P2", slots: 4 },
    });
    const before = await prisma.project.count();

    const out = await prisma.$transaction((tx) => reopenProjectFromApplication(tx, { app, actorUserId: s.actor.id }));

    expect(out).toEqual({ id: s.past.id });
    expect(await prisma.project.count()).toBe(before);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: s.past.id },
      include: {
        projectTerms: { include: { term: true } },
        termStatuses: true,
        partners: true,
        roleRequests: { include: { term: true } },
      },
    });
    expect(project.status).toBe("Active");
    expect(project.projectTerms.map((t) => t.term.code).sort()).toEqual(["26S", "27S", "27W"]);
    expect(project.termStatuses.filter((t) => t.isContinuing).map((t) => t.termId).sort()).toEqual(
      [s.t27w.id, s.t27s.id].sort(),
    );
    const winter = project.roleRequests.filter((r) => r.term.code === "27W").map((r) => [r.domainId, r.level, r.slots]);
    expect(winter.sort()).toEqual(
      [
        [s.eng.id, "P1", 3],
        [s.des.id, "P1", 1],
      ].sort(),
    );
    expect(project.roleRequests.filter((r) => r.term.code === "27S").map((r) => [r.level, r.slots])).toEqual([["P2", 4]]);
    expect(project.partners.filter((p) => p.endedAt === null).map((p) => p.partnerOrgId)).toEqual([s.org.id]);

    const promoted = await prisma.partnerApplication.findUniqueOrThrow({ where: { id: app.id } });
    expect(promoted).toMatchObject({ stage: "Accepted", resultingProjectId: s.past.id });
  });

  it("moves the application's planning note to the project, appending to one it already has", async () => {
    const s = await seed();
    const app = await returnApp(s, [s.t27w.id]);
    await prisma.planningNote.create({ data: { projectId: s.past.id, body: "Paused for funding" } });
    await prisma.planningNote.create({ data: { applicationId: app.id, body: "Grant came through" } });

    await prisma.$transaction((tx) => reopenProjectFromApplication(tx, { app, actorUserId: s.actor.id }));

    const notes = await prisma.planningNote.findMany();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      projectId: s.past.id,
      applicationId: null,
      body: "Paused for funding\n\nGrant came through",
      updatedById: s.actor.id,
    });
  });
});
