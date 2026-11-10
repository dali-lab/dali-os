import { prisma } from "~/lib/db.server";
import type { PageKind, WorkspaceType } from "~/generated/prisma/client";

let seq = 0;
const next = () => ++seq;

export async function makeUser(first = "Ada", last = "Lovelace") {
  const n = next();
  return prisma.user.create({
    data: { firstName: first, lastName: last, daliEmail: `ada${n}@example.edu` },
  });
}

export async function makeProject(name = "Analytical Engine") {
  return prisma.project.create({ data: { name } });
}

export async function makeOffering(title = "Intro Course") {
  return prisma.educationOffering.create({
    data: {
      type: "Workshop",
      title,
      capacity: 10,
      registrationOpensAt: new Date("2026-01-01"),
      registrationClosesAt: new Date("2026-02-01"),
      requiresReview: false,
    },
  });
}

export async function makePage(
  createdById: string,
  over: {
    title?: string;
    kind?: PageKind;
    workspaceType?: WorkspaceType;
    workspaceId?: string | null;
    parentPageId?: string | null;
    position?: number;
    archivedAt?: Date | null;
    folderType?: "Root" | "Meetings" | "Agreements" | null;
    processType?: "Core" | "Project" | "Lab" | "HiringCycle" | "Mentorship" | null;
    processId?: string | null;
    scopeKind?: "Private" | "Lab" | "Group" | null;
  } = {},
) {
  return prisma.page.create({
    data: {
      workspaceType: "Lab",
      workspaceId: null,
      title: `Page ${next()}`,
      kind: "FreeForm",
      createdById,
      ...over,
    },
  });
}
