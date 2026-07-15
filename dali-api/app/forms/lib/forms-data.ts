// Shared loader/action logic for the Forms feature. Both the top-level
// (/forms) and per-folder (/forms/:folderId) routes render the same card grid
// over one level of the folder tree, so the query + mutations live here.
//
// Forms store their question set in the shared `~/types` Question shape (the
// same one the hiring FormBuilderTab produces). FormVersion.questions is a
// JSON column, so adopting that shape needs no migration. FormVersion.intro
// (a String column) is repurposed to hold the builder's rich-text description
// as serialized ProseMirror JSON.

import { z } from "zod";
import { prisma, Prisma } from "~/lib/db";
import type { Question } from "~/types";
import { isReferenceSourceKey, referenceSourceNeedsTerm } from "./reference-sources.shared";
import type { FolderOption } from "./folder-tree.shared";
import { formDeletionBlockers } from "./form-usages.server";

const QUESTION_TYPES: Question["type"][] = [
  "text",
  "textarea",
  "select",
  "github_url",
  "figma_url",
  "drive_url",
  "file",
  "skills_rating",
  "checkbox",
  "reference",
];

export function isQuestionArray(x: unknown): x is Question[] {
  return (
    Array.isArray(x) &&
    x.every(
      (q) =>
        q &&
        typeof q === "object" &&
        typeof (q as Question).key === "string" &&
        QUESTION_TYPES.includes((q as Question).type) &&
        typeof (q as Question).required === "boolean" &&
        !!(q as Question).data &&
        typeof (q as Question).data === "object" &&
        typeof (q as Question).data.label === "string",
    )
  );
}

export type FormCard = {
  id: string;
  name: string;
  folderId: string | null;
  versionCount: number;
  published: boolean;
  publicToken: string | null;
  latestVersion: { id: string; questions: Question[]; description: unknown } | null;
};

export type FolderCard = {
  id: string;
  name: string;
  parentId: string | null;
  formCount: number;
  folderCount: number;
};

export type FolderCrumb = { id: string; name: string };

export type FormVersionDetail = {
  id: string;
  versionNumber: number;
  createdAt: string;
  createdByName: string;
  questions: Question[];
  description: unknown;
};

export type FormDetail = {
  id: string;
  name: string;
  folderId: string | null;
  createdAt: string;
  published: boolean;
  publicToken: string | null;
  oneResponsePerMember: boolean;
  notifyOnSubmission: boolean;
  versions: FormVersionDetail[];
  // Editable working copy, if one exists. The editor seeds the builder from
  // this; null means start from the latest version (or blank). Never served
  // to fillers.
  draft: { questions: Question[]; description: unknown } | null;
};

// The full form + every version (newest last), for the dedicated editor page.
// Mirrors the shape ChallengeDetail consumes.
export async function loadFormForEdit(
  formId: string,
): Promise<FormDetail | null> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    include: {
      versions: {
        orderBy: { versionNumber: "asc" },
        include: { createdBy: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!form) return null;
  const draftQuestions = form.draftQuestions
    ? (form.draftQuestions as unknown as Question[])
    : null;
  return {
    id: form.id,
    name: form.name,
    folderId: form.folderId,
    createdAt: form.createdAt.toISOString(),
    published: form.published,
    publicToken: form.publicToken,
    oneResponsePerMember: form.oneResponsePerMember,
    notifyOnSubmission: form.notifyOnSubmission,
    versions: form.versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      createdAt: v.createdAt.toISOString(),
      createdByName: `${v.createdBy.firstName} ${v.createdBy.lastName}`.trim(),
      questions: (v.questions as unknown as Question[]) ?? [],
      // intro holds serialized ProseMirror JSON (see module note).
      description: v.intro ? safeParseJsonString(v.intro) : null,
    })),
    draft: draftQuestions
      ? {
          questions: draftQuestions,
          // draftIntro mirrors FormVersion.intro (serialized ProseMirror JSON).
          description: safeParseJsonString(form.draftIntro),
        }
      : null,
  };
}

// One level of the tree: the folders/forms whose parent is `folderId`
// (null = top level), plus breadcrumb ancestry and the flat folder list used
// by the "move" pickers.
export async function loadFormsLevel(folderId: string | null) {
  const [childFolders, forms, allFolders, current] = await Promise.all([
    prisma.formFolder.findMany({
      where: { parentId: folderId },
      orderBy: { name: "asc" },
      include: { _count: { select: { forms: true, children: true } } },
    }),
    prisma.form.findMany({
      where: { folderId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { versions: true } },
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
    }),
    prisma.formFolder.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, parentId: true },
    }),
    folderId
      ? prisma.formFolder.findUnique({
          where: { id: folderId },
          select: { id: true, name: true, parentId: true },
        })
      : Promise.resolve(null),
  ]);

  if (folderId && !current) return null; // folder not found

  // Walk parent links to build breadcrumbs (root → current).
  const byId = new Map(allFolders.map((f) => [f.id, f]));
  const crumbs: FolderCrumb[] = [];
  let cursor = current?.parentId ?? null;
  while (cursor) {
    const node = byId.get(cursor);
    if (!node) break;
    crumbs.unshift({ id: node.id, name: node.name });
    cursor = node.parentId;
  }

  return {
    current: current
      ? { id: current.id, name: current.name, parentId: current.parentId }
      : null,
    crumbs,
    folders: childFolders.map<FolderCard>((d) => ({
      id: d.id,
      name: d.name,
      parentId: d.parentId,
      formCount: d._count.forms,
      folderCount: d._count.children,
    })),
    forms: forms.map<FormCard>((f) => {
      const v = f.versions[0];
      return {
        id: f.id,
        name: f.name,
        folderId: f.folderId,
        versionCount: f._count.versions,
        published: f.published,
        publicToken: f.publicToken,
        latestVersion: v
          ? {
              id: v.id,
              questions: (v.questions as unknown as Question[]) ?? [],
              // intro holds serialized ProseMirror JSON (see module note).
              description: v.intro ? safeParseJsonString(v.intro) : null,
            }
          : null,
      };
    }),
    allFolders: allFolders.map<FolderOption>((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
    })),
  };
}

export function safeParseJsonString(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// "" / undefined → null (top level), else verify the folder exists.
async function resolveFolderId(
  raw: string | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  if (!raw) return { ok: true, value: null };
  const folder = await prisma.formFolder.findUnique({
    where: { id: raw },
    select: { id: true },
  });
  return folder ? { ok: true, value: folder.id } : { ok: false };
}

// A folder cannot be moved into itself or any of its own descendants
// (that would orphan a cycle from the tree).
async function isDescendantOrSelf(
  candidateParentId: string,
  folderId: string,
): Promise<boolean> {
  if (candidateParentId === folderId) return true;
  const all = await prisma.formFolder.findMany({
    select: { id: true, parentId: true },
  });
  const byId = new Map(all.map((f) => [f.id, f.parentId]));
  let cursor: string | null | undefined = candidateParentId;
  while (cursor) {
    if (cursor === folderId) return true;
    cursor = byId.get(cursor);
  }
  return false;
}

export const ActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create-form"),
    name: z.string().trim().min(1).max(120),
    folderId: z.string().optional(), // "" = top level
  }),
  z.object({
    intent: z.literal("rename-form"),
    id: z.string().min(1),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({ intent: z.literal("delete-form"), id: z.string().min(1) }),
  z.object({
    intent: z.literal("move-form"),
    id: z.string().min(1),
    folderId: z.string().optional(), // "" = top level
  }),
  z.object({
    // "Save" — persist the editable working copy. Lenient: a draft may hold a
    // work-in-progress question set, so it isn't held to save-version's rules.
    intent: z.literal("save-draft"),
    id: z.string().min(1),
    questions: z.string(), // JSON-encoded Question[]
    description: z.string().optional(), // JSON-encoded ProseMirror doc
  }),
  z.object({
    intent: z.literal("save-version"),
    id: z.string().min(1),
    questions: z.string(), // JSON-encoded Question[]
    description: z.string().optional(), // JSON-encoded ProseMirror doc
  }),
  z.object({
    intent: z.literal("create-folder"),
    name: z.string().trim().min(1).max(120),
    parentId: z.string().optional(), // "" = top level
  }),
  z.object({
    intent: z.literal("rename-folder"),
    id: z.string().min(1),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({ intent: z.literal("delete-folder"), id: z.string().min(1) }),
  z.object({
    intent: z.literal("move-folder"),
    id: z.string().min(1),
    parentId: z.string().optional(), // "" = top level
  }),
  z.object({ intent: z.literal("publish-form"), id: z.string().min(1) }),
  z.object({ intent: z.literal("unpublish-form"), id: z.string().min(1) }),
  z.object({
    intent: z.literal("update-form-settings"),
    id: z.string().min(1),
    oneResponsePerMember: z.enum(["true", "false"]),
    notifyOnSubmission: z.enum(["true", "false"]),
  }),
]);

// Unguessable public token for a published form's external fill URL.
function newPublicToken(): string {
  // 24 bytes of URL-safe randomness — collision-resistant, not enumerable.
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type FormsActionResult =
  | { ok: true }
  | { error: string; status: number };

export async function runFormsAction(
  formData: FormData,
  userId: string,
): Promise<FormsActionResult> {
  const parsed = ActionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input", status: 400 };
  const input = parsed.data;

  switch (input.intent) {
    case "create-form": {
      const folder = await resolveFolderId(input.folderId);
      if (!folder.ok) return { error: "Folder not found", status: 404 };
      await prisma.form.create({
        data: {
          name: input.name,
          folderId: folder.value,
          createdById: userId,
        },
      });
      return { ok: true };
    }
    case "move-form": {
      const exists = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };
      const folder = await resolveFolderId(input.folderId);
      if (!folder.ok) return { error: "Folder not found", status: 404 };
      await prisma.form.update({
        where: { id: input.id },
        data: { folderId: folder.value },
      });
      return { ok: true };
    }
    case "rename-form": {
      const exists = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };
      await prisma.form.update({
        where: { id: input.id },
        data: { name: input.name },
      });
      return { ok: true };
    }
    case "delete-form": {
      const exists = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };
      // Deletion cascades submissions and bindings away — refuse while any
      // live surface depends on this form (see form-usages.server.ts).
      const blockers = await formDeletionBlockers(input.id);
      if (blockers.length > 0) {
        return {
          error: `This form is in use: ${blockers.join("; ")}. Remove those bindings first.`,
          status: 409,
        };
      }
      await prisma.form.delete({ where: { id: input.id } });
      return { ok: true };
    }
    case "save-draft": {
      const exists = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };

      // The draft is a working copy — parse it but don't enforce save-version's
      // completeness rules (labels, valid reference sources, non-empty). It's
      // never served to fillers, so a half-finished draft is fine to store.
      let questions: unknown;
      try {
        questions = JSON.parse(input.questions);
      } catch {
        return { error: "Could not parse questions.", status: 400 };
      }
      if (!isQuestionArray(questions))
        return { error: "Could not parse questions.", status: 400 };

      await prisma.form.update({
        where: { id: input.id },
        data: {
          draftQuestions: questions as object,
          draftIntro: input.description?.trim() || null,
        },
      });
      return { ok: true };
    }
    case "save-version": {
      const exists = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };

      let questions: unknown;
      try {
        questions = JSON.parse(input.questions);
      } catch {
        return { error: "Could not parse questions.", status: 400 };
      }
      if (!isQuestionArray(questions) || questions.length === 0)
        return { error: "Add at least one valid question.", status: 400 };
      for (const q of questions) {
        if (!q.data.label.trim())
          return { error: "Every question needs a label.", status: 400 };
        if (q.type === "reference" && !isReferenceSourceKey(q.data.referenceSource))
          return {
            error: `"${q.data.label}" is a reference question but has no valid data source.`,
            status: 400,
          };
        if (
          q.type === "reference" &&
          referenceSourceNeedsTerm(q.data.referenceSource) &&
          !q.data.referenceTermId
        )
          return {
            error: `"${q.data.label}" needs a term selected for its data source.`,
            status: 400,
          };
      }

      const last = await prisma.formVersion.findFirst({
        where: { formId: input.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      // Freeze the working copy into an immutable, fillable version and clear
      // the draft — the two happen together so the editor never shows a stale
      // draft alongside the version it just became.
      await prisma.$transaction([
        prisma.formVersion.create({
          data: {
            formId: input.id,
            versionNumber: (last?.versionNumber ?? 0) + 1,
            questions: questions as object,
            // Reuse the intro column to store the rich-text description JSON.
            intro: input.description?.trim() || null,
            createdById: userId,
          },
        }),
        prisma.form.update({
          where: { id: input.id },
          data: { draftQuestions: Prisma.DbNull, draftIntro: null },
        }),
      ]);
      return { ok: true };
    }
    case "create-folder": {
      if (input.parentId) {
        const parent = await prisma.formFolder.findUnique({
          where: { id: input.parentId },
          select: { id: true },
        });
        if (!parent) return { error: "Parent folder not found", status: 404 };
      }
      await prisma.formFolder.create({
        data: {
          name: input.name,
          parentId: input.parentId || null,
          createdById: userId,
        },
      });
      return { ok: true };
    }
    case "rename-folder": {
      const exists = await prisma.formFolder.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };
      await prisma.formFolder.update({
        where: { id: input.id },
        data: { name: input.name },
      });
      return { ok: true };
    }
    case "move-folder": {
      const exists = await prisma.formFolder.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };
      const target = input.parentId || null;
      if (target) {
        const parent = await prisma.formFolder.findUnique({
          where: { id: target },
          select: { id: true },
        });
        if (!parent) return { error: "Parent folder not found", status: 404 };
        if (await isDescendantOrSelf(target, input.id))
          return {
            error: "Can't move a folder into itself or its own subfolder.",
            status: 400,
          };
      }
      await prisma.formFolder.update({
        where: { id: input.id },
        data: { parentId: target },
      });
      return { ok: true };
    }
    case "delete-folder": {
      const exists = await prisma.formFolder.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };
      // Form.folderId and FormFolder.parentId are both onDelete: SetNull —
      // this folder's forms and subfolders fall back to the top level.
      await prisma.formFolder.delete({ where: { id: input.id } });
      return { ok: true };
    }
    case "publish-form": {
      const form = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true, publicToken: true, _count: { select: { versions: true } } },
      });
      if (!form) return { error: "Not found", status: 404 };
      if (form._count.versions === 0)
        return {
          error: "Add at least one question version before publishing.",
          status: 400,
        };
      await prisma.form.update({
        where: { id: input.id },
        data: {
          published: true,
          // Mint a token on first publish; reuse it on re-publish so a
          // shared link stays valid.
          publicToken: form.publicToken ?? newPublicToken(),
        },
      });
      return { ok: true };
    }
    case "unpublish-form": {
      const exists = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };
      // Keep publicToken so re-publishing restores the same link; just flip
      // the flag so the public route 404s.
      await prisma.form.update({
        where: { id: input.id },
        data: { published: false },
      });
      return { ok: true };
    }
    case "update-form-settings": {
      const exists = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };
      await prisma.form.update({
        where: { id: input.id },
        data: {
          oneResponsePerMember: input.oneResponsePerMember === "true",
          notifyOnSubmission: input.notifyOnSubmission === "true",
        },
      });
      return { ok: true };
    }
  }
}
