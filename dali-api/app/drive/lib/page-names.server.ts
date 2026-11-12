import { prisma } from "~/lib/db.server";
import type { PageKind, WorkspaceType } from "~/generated/prisma/client";

const KIND_LABELS: Partial<Record<PageKind | "File", string>> = {
  Folder: "folder",
  FreeForm: "document",
  Notebook: "notebook",
  Whiteboard: "whiteboard",
  Slides: "slide deck",
  Form: "form",
  File: "file",
};

export type NamePlace = {
  workspaceType: WorkspaceType;
  workspaceId: string | null;
  /** The folder it sits in; for a file, its `folderPageId`. Null is the workspace's top level. */
  parentPageId: string | null;
};

export type NameCheck = NamePlace & {
  kind: PageKind | "File";
  title: string;
  /** The row being renamed or moved, which never conflicts with itself. */
  excludeId?: string;
};

export class PageNameConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "PageNameConflictError";
  }
}

/** The refusal message when a live item of the same kind already has this name in this place; null when the name is free. Anything inside a notebook is exempt, since its notes are told apart by date. */
export async function findNameConflict(input: NameCheck): Promise<string | null> {
  const label = KIND_LABELS[input.kind];
  if (!label) return null;
  const title = input.title.trim();
  const same = { title: { equals: title, mode: "insensitive" as const } };
  const notSelf = input.excludeId ? { id: { not: input.excludeId } } : {};

  const clash =
    input.kind === "File"
      ? await prisma.projectFile.findFirst({
          where: {
            ...(input.workspaceType === "Project"
              ? { projectId: input.workspaceId }
              : { workspaceType: input.workspaceType, workspaceId: input.workspaceId }),
            folderPageId: input.parentPageId,
            archivedAt: null,
            ...same,
            ...notSelf,
          },
          select: { id: true },
        })
      : await prisma.page.findFirst({
          where: {
            workspaceType: input.workspaceType,
            workspaceId: input.workspaceId,
            parentPageId: input.parentPageId,
            ...(input.parentPageId ? { parent: { kind: { not: "Notebook" as const } } } : {}),
            kind: input.kind,
            archivedAt: null,
            isTemplate: false,
            ...same,
            ...notSelf,
          },
          select: { id: true },
        });

  return clash ? `A ${label} named “${title}” already exists here` : null;
}

export async function assertUniqueName(input: NameCheck): Promise<void> {
  const conflict = await findNameConflict(input);
  if (conflict) throw new PageNameConflictError(conflict);
}

/** The 409 for a PageNameConflictError; null for any other error. */
export function nameConflictResponse(err: unknown): Response | null {
  return err instanceof PageNameConflictError ? Response.json({ error: err.message }, { status: 409 }) : null;
}
