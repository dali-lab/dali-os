// A form is a Drive page (Page.kind Form) plus a Form row sharing its id.
// Every write that touches what both rows carry goes through here so the two
// never drift: placement (folderPageId / parentPageId), title (name / title),
// trash (archivedAt on both), and the fill audience (Form.audience / Page
// general access). The Form columns stay written until the cleanup PR drops
// them; readers may use either side meanwhile.

import { prisma, Prisma } from "~/lib/db";
import type { FormAudience, LinkAccess, WorkspaceType } from "~/generated/prisma/client";

export function linkAccessForAudience(audience: FormAudience): LinkAccess {
  switch (audience) {
    case "Public":
      return "Public";
    case "Members":
      return "LabMembers";
    case "SignedIn":
      return "SignedIn";
    case "Groups":
      return "Restricted";
  }
}

type Workspace = { workspaceType: WorkspaceType; workspaceId: string | null };

// A form takes the workspace of the folder it sits in; an unplaced form is a
// Lab page, which is where the Drive has always shown it.
async function workspaceForFolder(folderPageId: string | null): Promise<Workspace> {
  if (!folderPageId) return { workspaceType: "Lab", workspaceId: null };
  const folder = await prisma.page.findUnique({
    where: { id: folderPageId },
    select: { workspaceType: true, workspaceId: true },
  });
  return folder ?? { workspaceType: "Lab", workspaceId: null };
}

async function nextPosition(ws: Workspace, parentPageId: string | null): Promise<number> {
  const last = await prisma.page.findFirst({
    where: { workspaceType: ws.workspaceType, workspaceId: ws.workspaceId, parentPageId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

export type CreateFormInput = Omit<Prisma.FormCreateInput, "page" | "createdBy"> & {
  name: string;
  createdById: string;
  folderPageId?: string | null;
};

// Creates the Form and its Page in one statement. Accepts everything
// prisma.form.create does (versions, draft, templateKey, publish state) plus
// the placement, so callers swap `prisma.form.create({ data })` for
// `createForm(data)` without reshaping their input.
export async function createForm<S extends Prisma.FormSelect = { id: true }>(
  input: CreateFormInput,
  select?: S,
): Promise<Prisma.FormGetPayload<{ select: S }>> {
  const { name, createdById, folderPageId = null, ...rest } = input;
  const ws = await workspaceForFolder(folderPageId);
  const audience = (rest.audience ?? "Members") as FormAudience;
  const groupIds = Array.isArray(rest.audienceGroupIds)
    ? rest.audienceGroupIds
    : (rest.audienceGroupIds?.set ?? []);
  return prisma.form.create({
    data: {
      ...rest,
      name,
      folderPageId,
      createdBy: { connect: { id: createdById } },
      page: {
        create: {
          ...ws,
          parentPageId: folderPageId,
          title: name,
          kind: "Form",
          position: await nextPosition(ws, folderPageId),
          createdById,
          lastEditedById: createdById,
          archivedAt: rest.archivedAt ?? null,
          linkAccess: linkAccessForAudience(audience),
          linkPermission: "View",
          shares:
            audience === "Groups" && groupIds.length > 0
              ? {
                  create: groupIds.map((gid) => ({
                    principalType: "Group" as const,
                    principalId: gid,
                    permission: "View" as const,
                    createdById,
                  })),
                }
              : undefined,
        },
      },
    },
    select: (select ?? { id: true }) as S,
  }) as Promise<Prisma.FormGetPayload<{ select: S }>>;
}

export async function renameForm(id: string, name: string): Promise<void> {
  await prisma.$transaction([
    prisma.form.update({ where: { id }, data: { name } }),
    prisma.page.update({ where: { id }, data: { title: name } }),
  ]);
}

export async function setFormIcon(id: string, iconEmoji: string | null): Promise<void> {
  await prisma.page.update({ where: { id }, data: { iconEmoji } });
}

export async function moveForm(id: string, folderPageId: string | null): Promise<void> {
  const ws = await workspaceForFolder(folderPageId);
  await prisma.$transaction([
    prisma.form.update({ where: { id }, data: { folderPageId } }),
    prisma.page.update({
      where: { id },
      data: { parentPageId: folderPageId, ...ws, position: await nextPosition(ws, folderPageId) },
    }),
  ]);
}

export async function setFormArchived(id: string, archivedAt: Date | null): Promise<void> {
  await prisma.$transaction([
    prisma.form.update({ where: { id }, data: { archivedAt } }),
    prisma.page.update({ where: { id }, data: { archivedAt } }),
  ]);
}

// Deleting the Page cascades to the Form row, and from there to versions and
// submissions. Callers check formDeletionBlockers first.
export async function deleteForm(id: string): Promise<void> {
  await prisma.page.delete({ where: { id } });
}

// Mirrors the fill audience onto the page: general access for the broad
// tiers, and for Groups one View share per group (replacing the previous set).
export async function setFormAudience(
  id: string,
  audience: FormAudience,
  groupIds: string[],
  actorId: string,
): Promise<void> {
  const ids = audience === "Groups" ? [...new Set(groupIds)] : [];
  await prisma.$transaction([
    prisma.form.update({ where: { id }, data: { audience, audienceGroupIds: ids } }),
    prisma.page.update({
      where: { id },
      data: { linkAccess: linkAccessForAudience(audience), linkPermission: "View" },
    }),
    prisma.pageShare.deleteMany({
      where: { pageId: id, principalType: "Group", ...(ids.length ? { principalId: { notIn: ids } } : {}) },
    }),
    ...ids.map((gid) =>
      prisma.pageShare.upsert({
        where: { pageId_principalType_principalId: { pageId: id, principalType: "Group", principalId: gid } },
        update: { permission: "View" },
        create: { pageId: id, principalType: "Group", principalId: gid, permission: "View", createdById: actorId },
      }),
    ),
  ]);
}
