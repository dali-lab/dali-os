import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { setTermSpots } from "../planning-spots.server";

async function seed() {
  const term = await prisma.term.create({
    data: { code: "26S", year: 2026, season: "S", sortKey: 20262, startDate: new Date("2026-03-30"), endDate: new Date("2026-06-05") },
  });
  const other = await prisma.term.create({
    data: { code: "26F", year: 2026, season: "F", sortKey: 20264, startDate: new Date("2026-09-15"), endDate: new Date("2026-11-30") },
  });
  const project = await prisma.project.create({ data: { name: "Atlas" } });
  await prisma.projectTerm.create({ data: { projectId: project.id, termId: term.id } });
  const eng = await prisma.domain.create({ data: { name: "Engineering", code: "ENG", displayName: "Engineering" } });
  const des = await prisma.domain.create({ data: { name: "Design", code: "DES", displayName: "Design" } });
  return { term, other, project, eng, des };
}

async function spots(projectId: string, termId: string) {
  const rows = await prisma.projectRoleRequest.findMany({
    where: { projectId, termId },
    select: { domainId: true, level: true, slots: true, notesDocId: true },
    orderBy: [{ domainId: "asc" }, { level: "asc" }],
  });
  return rows;
}

describe("setTermSpots against Postgres", () => {
  it("saves spots for a term the project is on", async () => {
    const { term, project, eng, des } = await seed();
    await prisma.projectRoleRequest.create({
      data: { projectId: project.id, termId: term.id, domainId: eng.id, level: "P1", slots: 2 },
    });

    const result = await setTermSpots(prisma, {
      projectId: project.id,
      termId: term.id,
      roles: [
        { domainId: eng.id, slots: 3 },
        { domainId: des.id, slots: 1 },
      ],
    });

    expect(result).toBe("ok");
    expect(await spots(project.id, term.id)).toEqual(
      [
        { domainId: eng.id, level: "P1", slots: 3, notesDocId: null },
        { domainId: des.id, level: "P1", slots: 1, notesDocId: null },
      ].sort((a, b) => a.domainId.localeCompare(b.domainId)),
    );
  });

  it("keeps mentor rows and role notes while cutting learner spots", async () => {
    const { term, project, eng } = await seed();
    await prisma.projectRoleRequest.createMany({
      data: [
        { projectId: project.id, termId: term.id, domainId: eng.id, level: "P1", slots: 2, notesDocId: "doc-learner" },
        { projectId: project.id, termId: term.id, domainId: eng.id, level: "P3", slots: 1, notesDocId: "doc-mentor" },
      ],
    });

    await setTermSpots(prisma, { projectId: project.id, termId: term.id, roles: [{ domainId: eng.id, slots: 2 }] });

    expect(await spots(project.id, term.id)).toEqual([
      { domainId: eng.id, level: "P1", slots: 1, notesDocId: "doc-learner" },
      { domainId: eng.id, level: "P3", slots: 1, notesDocId: "doc-mentor" },
    ]);
  });

  it("refuses a term the project is not on and writes nothing", async () => {
    const { other, project, eng } = await seed();
    const result = await setTermSpots(prisma, {
      projectId: project.id,
      termId: other.id,
      roles: [{ domainId: eng.id, slots: 2 }],
    });
    expect(result).toBe("not-in-term");
    expect(await spots(project.id, other.id)).toEqual([]);
  });

  it("refuses an inactive domain", async () => {
    const { term, project } = await seed();
    const retired = await prisma.domain.create({
      data: { name: "Retired", code: "RET", displayName: "Retired", active: false },
    });
    const result = await setTermSpots(prisma, {
      projectId: project.id,
      termId: term.id,
      roles: [{ domainId: retired.id, slots: 1 }],
    });
    expect(result).toBe("unknown-domain");
    expect(await spots(project.id, term.id)).toEqual([]);
  });
});
