import { prisma } from "~/lib/db";

export async function listTemplates() {
  return prisma.educationApplicationTemplate.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      _count: { select: { questions: true } },
    },
  });
}

export async function getTemplate(id: string) {
  return prisma.educationApplicationTemplate.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { position: "asc" } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
  });
}

export async function createTemplate(input: {
  name: string;
  description: string | null;
  createdById: string;
  questions: { prompt: string; required: boolean }[];
}) {
  const template = await prisma.educationApplicationTemplate.create({
    data: {
      name: input.name,
      description: input.description,
      createdById: input.createdById,
    },
  });
  if (input.questions.length > 0) {
    await prisma.educationApplicationTemplateQuestion.createMany({
      data: input.questions.map((q, i) => ({
        templateId: template.id,
        prompt: q.prompt,
        position: i,
        required: q.required,
      })),
    });
  }
  return template;
}

export async function updateTemplate(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    questions?: { prompt: string; required: boolean }[];
  },
) {
  if (patch.name !== undefined || patch.description !== undefined) {
    await prisma.educationApplicationTemplate.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
      },
    });
  }
  if (patch.questions !== undefined) {
    await prisma.educationApplicationTemplateQuestion.deleteMany({
      where: { templateId: id },
    });
    if (patch.questions.length > 0) {
      await prisma.educationApplicationTemplateQuestion.createMany({
        data: patch.questions.map((q, i) => ({
          templateId: id,
          prompt: q.prompt,
          position: i,
          required: q.required,
        })),
      });
    }
  }
  return getTemplate(id);
}

export async function deleteTemplate(id: string) {
  // Cascade on questions handles its child rows.
  await prisma.educationApplicationTemplate.delete({ where: { id } });
}

export async function applyTemplateToOffering(templateId: string, offeringId: string) {
  const template = await getTemplate(templateId);
  if (!template) throw new Error("Template not found");
  // Replace the offering's question list with the template's.
  await prisma.educationApplicationQuestion.deleteMany({ where: { offeringId } });
  if (template.questions.length === 0) return [];
  await prisma.educationApplicationQuestion.createMany({
    data: template.questions.map((q, i) => ({
      offeringId,
      prompt: q.prompt,
      position: i,
      required: q.required,
    })),
  });
  return prisma.educationApplicationQuestion.findMany({
    where: { offeringId },
    orderBy: { position: "asc" },
  });
}
