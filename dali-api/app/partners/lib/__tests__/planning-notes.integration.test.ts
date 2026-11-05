import { describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { setPlanningNote } from "../planning-notes.server";

async function seed() {
  const ada = await prisma.user.create({ data: { firstName: "Ada", lastName: "Lovelace" } });
  const grace = await prisma.user.create({ data: { firstName: "Grace", lastName: "Hopper" } });
  const project = await prisma.project.create({ data: { name: "Atlas" } });
  const contact = await prisma.partnerContact.create({ data: { name: "Pat Partner", email: "pat@example.org" } });
  const application = await prisma.partnerApplication.create({
    data: { title: "Beacon", applicantContactId: contact.id },
  });
  return { ada, grace, project, application };
}

describe("setPlanningNote against Postgres", () => {
  it("creates one note per project and updates it in place", async () => {
    const { ada, grace, project } = await seed();
    await setPlanningNote(prisma, { owner: { projectId: project.id }, body: "Waiting on budget", userId: ada.id });
    await setPlanningNote(prisma, { owner: { projectId: project.id }, body: "Budget approved", userId: grace.id });
    const notes = await prisma.planningNote.findMany({ where: { projectId: project.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ body: "Budget approved", updatedById: grace.id, applicationId: null });
  });

  it("keeps project and application notes apart", async () => {
    const { ada, project, application } = await seed();
    await setPlanningNote(prisma, { owner: { projectId: project.id }, body: "Project note", userId: ada.id });
    await setPlanningNote(prisma, { owner: { applicationId: application.id }, body: "Application note", userId: ada.id });
    const byApp = await prisma.planningNote.findUnique({ where: { applicationId: application.id } });
    expect(byApp).toMatchObject({ body: "Application note", projectId: null });
    expect(await prisma.planningNote.count()).toBe(2);
  });

  it("removes the note when saved blank", async () => {
    const { ada, project } = await seed();
    await setPlanningNote(prisma, { owner: { projectId: project.id }, body: "Temp", userId: ada.id });
    await setPlanningNote(prisma, { owner: { projectId: project.id }, body: "  ", userId: ada.id });
    expect(await prisma.planningNote.count()).toBe(0);
  });

  it("goes away with its application, and keeps the note when the editor is deleted", async () => {
    const { ada, project, application } = await seed();
    await setPlanningNote(prisma, { owner: { applicationId: application.id }, body: "Gone soon", userId: ada.id });
    await setPlanningNote(prisma, { owner: { projectId: project.id }, body: "Stays", userId: ada.id });
    await prisma.partnerApplication.delete({ where: { id: application.id } });
    await prisma.user.delete({ where: { id: ada.id } });
    const left = await prisma.planningNote.findMany();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ projectId: project.id, body: "Stays", updatedById: null });
  });
});
