// Shared loader/action logic for the Forms feature. The form editor and the
// unified Drive both drive form mutations through runFormsAction here; forms are
// organised by folderPageId (a Drive Page folder), not a separate folder tree.
//
// Forms store their question set in the shared `~/types` Question shape (the
// same one the hiring FormBuilderTab produces). FormVersion.questions is a
// JSON column, so adopting that shape needs no migration. FormVersion.intro
// (a String column) is repurposed to hold the builder's rich-text description
// as serialized ProseMirror JSON.

import { z } from "zod";
import { prisma, Prisma } from "~/lib/db";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import type { Question } from "~/types";
import { isReferenceSourceKey, referenceSourceNeedsTerm } from "./reference-sources.shared";
import { formDeletionBlockers, formUsages, managingUsage } from "./form-usages.server";
import { isGroupArchived } from "~/lib/groups";

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
  "pageBreak",
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

// Parse + validate a version's question set to the same standard "Save as
// version" enforces (≥1 question, every question labelled, reference sources
// resolved). Shared by save-version and update-version so an in-place edit is
// held to exactly the rules a fresh version is. Returns the parsed questions
// on success, or a ready-to-return error result.
function validateVersionQuestions(
  raw: string,
): { ok: true; questions: Question[] } | { error: string; status: number } {
  let questions: unknown;
  try {
    questions = JSON.parse(raw);
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
  return { ok: true, questions };
}

// Thrown inside the update/delete-version transaction when the lock re-check
// finds the version has been used since the editor loaded it, so the tx rolls
// back and the caller returns a 409 instead of clobbering answered content.
class VersionLockedError extends Error {}

// A version is LOCKED once its questions have been served in a real response:
// a FormSubmission, or a hiring Application/DomainApplication that pinned it at
// draft start. Locked versions are frozen — no in-place edit/delete; changes
// must append a new version. Unlocked versions (nobody has used them yet) stay
// editable, which is how an accidental "Save as version" gets corrected.
export async function isFormVersionLocked(versionId: string): Promise<boolean> {
  const [submission, pinnedApplication, pinnedChallenge] = await Promise.all([
    prisma.formSubmission.findFirst({
      where: { formVersionId: versionId },
      select: { id: true },
    }),
    prisma.application.findFirst({
      where: { applicationFormVersionId: versionId },
      select: { id: true },
    }),
    prisma.domainApplication.findFirst({
      where: { challengeFormVersionId: versionId },
      select: { id: true },
    }),
  ]);
  return Boolean(submission || pinnedApplication || pinnedChallenge);
}

// Locked state for every version of a form, in one round-trip — feeds the
// editor loader so each version card knows whether it's still editable. A
// version id present in the returned set is locked.
export async function lockedVersionIds(formId: string): Promise<Set<string>> {
  const [submitted, pinnedApps, pinnedChallenges] = await Promise.all([
    prisma.formSubmission.findMany({
      where: { formId },
      distinct: ["formVersionId"],
      select: { formVersionId: true },
    }),
    prisma.application.findMany({
      where: { applicationFormVersion: { formId } },
      distinct: ["applicationFormVersionId"],
      select: { applicationFormVersionId: true },
    }),
    prisma.domainApplication.findMany({
      where: { challengeFormVersion: { formId } },
      distinct: ["challengeFormVersionId"],
      select: { challengeFormVersionId: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const s of submitted) ids.add(s.formVersionId);
  for (const a of pinnedApps) if (a.applicationFormVersionId) ids.add(a.applicationFormVersionId);
  for (const d of pinnedChallenges) if (d.challengeFormVersionId) ids.add(d.challengeFormVersionId);
  return ids;
}

export type FormVersionDetail = {
  id: string;
  versionNumber: number;
  createdAt: string;
  // Fingerprint of the version's current content — bumps on each in-place
  // edit. Carried by fillers so a mid-fill edit is caught at submit.
  updatedAt: string;
  createdByName: string;
  questions: Question[];
  description: unknown;
  submissionCount: number;
  // False while the version has never been used (no submission, no hiring pin):
  // it can be edited or deleted in place. True once used — frozen.
  locked: boolean;
};

export type FormDetail = {
  id: string;
  name: string;
  folderPageId: string | null;
  createdAt: string;
  published: boolean;
  publicToken: string | null;
  opensAt: string | null;
  closesAt: string | null;
  oneResponsePerMember: boolean;
  notifyOnSubmission: boolean;
  listed: boolean;
  audience: "Members" | "SignedIn" | "Groups" | "Public";
  audienceGroupIds: string[];
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
  const [form, locked] = await Promise.all([
    prisma.form.findUnique({
      where: { id: formId },
      include: {
        versions: {
          orderBy: { versionNumber: "asc" },
          include: {
            createdBy: { select: { firstName: true, lastName: true } },
            _count: { select: { submissions: true } },
          },
        },
      },
    }),
    lockedVersionIds(formId),
  ]);
  if (!form) return null;
  const draftQuestions = form.draftQuestions
    ? (form.draftQuestions as unknown as Question[])
    : null;
  return {
    id: form.id,
    name: form.name,
    folderPageId: form.folderPageId,
    createdAt: form.createdAt.toISOString(),
    published: form.published,
    publicToken: form.publicToken,
    opensAt: form.opensAt?.toISOString() ?? null,
    closesAt: form.closesAt?.toISOString() ?? null,
    oneResponsePerMember: form.oneResponsePerMember,
    notifyOnSubmission: form.notifyOnSubmission,
    listed: form.listed,
    audience: form.audience,
    audienceGroupIds: form.audienceGroupIds,
    versions: form.versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      createdByName: `${v.createdBy.firstName} ${v.createdBy.lastName}`.trim(),
      questions: (v.questions as unknown as Question[]) ?? [],
      // intro holds serialized rich-text JSON: block JSON going forward,
      // ProseMirror on legacy versions — normalized on read.
      description: v.intro ? ensureBlocks(safeParseJsonString(v.intro)) : null,
      submissionCount: v._count.submissions,
      locked: locked.has(v.id),
    })),
    draft: draftQuestions
      ? {
          questions: draftQuestions,
          // draftIntro mirrors FormVersion.intro. Drafts are rewritten in
          // block format on the next save; legacy PM drafts convert on read.
          description: ensureBlocks(safeParseJsonString(form.draftIntro)),
        }
      : null,
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

// Verify a Drive Page-folder exists (kind=Folder) for form placement. "" /
// undefined → null (top level / unplaced).
async function resolveFolderPageId(
  raw: string | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  if (!raw) return { ok: true, value: null };
  const page = await prisma.page.findFirst({
    where: { id: raw, kind: "Folder" },
    select: { id: true },
  });
  return page ? { ok: true, value: page.id } : { ok: false };
}

export const ActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create-form"),
    name: z.string().trim().min(1).max(120),
    folderPageId: z.string().optional(), // Drive Page-folder placement; "" or absent = unplaced
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
    folderPageId: z.string().optional(), // Drive Page-folder; "" = top level
  }),
  z.object({ intent: z.literal("duplicate-form"), id: z.string().min(1) }),
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
    // Edit a not-yet-used version in place (same content rules as
    // save-version). Rejected 409 once the version is locked — see
    // isFormVersionLocked. No new version row, versionNumber unchanged.
    intent: z.literal("update-version"),
    id: z.string().min(1),
    versionId: z.string().min(1),
    questions: z.string(), // JSON-encoded Question[]
    description: z.string().optional(), // JSON-encoded ProseMirror doc
  }),
  z.object({
    // Remove a not-yet-used version (accidental-versioning cleanup). Rejected
    // 409 once locked. Deleting the only version is allowed — the form reverts
    // to a no-usable-version state, same as before its first save.
    intent: z.literal("delete-version"),
    id: z.string().min(1),
    versionId: z.string().min(1),
  }),
  z.object({ intent: z.literal("publish-form"), id: z.string().min(1) }),
  z.object({ intent: z.literal("unpublish-form"), id: z.string().min(1) }),
  z.object({
    intent: z.literal("update-form-window"),
    id: z.string().min(1),
    opensAt: z.string().optional(), // ISO timestamp; "" clears
    closesAt: z.string().optional(),
  }),
  z.object({
    intent: z.literal("update-form-settings"),
    id: z.string().min(1),
    oneResponsePerMember: z.enum(["true", "false"]),
    notifyOnSubmission: z.enum(["true", "false"]),
    listed: z.enum(["true", "false"]),
  }),
  z.object({
    intent: z.literal("update-form-audience"),
    id: z.string().min(1),
    audience: z.enum(["Members", "SignedIn", "Groups", "Public"]),
    groupIds: z.string().optional(), // JSON-encoded string[]; Groups only
  }),
]);

// Unguessable public token for a published form's external fill URL.
// Exported for the form-windows job, which mints one on scheduled publish.
export function newPublicToken(): string {
  // 24 bytes of URL-safe randomness — collision-resistant, not enumerable.
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseWindowBoundary(raw: string | undefined): Date | null | "invalid" {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export type FormsActionResult =
  // `formId` is set by duplicate-form so the UI can jump to the new copy.
  | { ok: true; formId?: string }
  | { error: string; status: number };

export async function runFormsAction(
  formData: FormData,
  userId: string,
): Promise<FormsActionResult> {
  const parsed = ActionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input", status: 400 };
  const input = parsed.data;

  // Managed forms (owned by hiring/education/staffing/partner) have their
  // distribution governed by that feature — reject any attempt to change
  // publish/schedule/audience/response settings, even via a crafted request.
  const DISTRIBUTION_INTENTS = new Set([
    "publish-form",
    "unpublish-form",
    "update-form-settings",
    "update-form-audience",
  ]);
  if (DISTRIBUTION_INTENTS.has(input.intent) && "id" in input) {
    if (managingUsage(await formUsages(input.id))) {
      return {
        error:
          "This form is managed by another feature; its distribution settings are controlled there.",
        status: 409,
      };
    }
  }

  switch (input.intent) {
    case "create-form": {
      const folder = await resolveFolderPageId(input.folderPageId);
      if (!folder.ok) return { error: "Folder not found", status: 404 };
      const created = await prisma.form.create({
        data: {
          name: input.name,
          folderPageId: folder.value,
          createdById: userId,
        },
        select: { id: true },
      });
      return { ok: true, formId: created.id };
    }
    case "duplicate-form": {
      const source = await prisma.form.findUnique({
        where: { id: input.id },
        select: {
          name: true,
          folderPageId: true,
          draftQuestions: true,
          draftIntro: true,
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { questions: true, intro: true },
          },
        },
      });
      if (!source) return { error: "Not found", status: 404 };

      // Seed the copy's DRAFT from the source's draft when one exists (the
      // author's newest thinking), else its latest version. The copy starts
      // unpublished/unlisted with default settings and audience — a copy must
      // never silently inherit a Public audience or live link — and belongs
      // to the duplicating user.
      const latest = source.versions[0] ?? null;
      const questions = source.draftQuestions ?? latest?.questions ?? null;
      const intro = source.draftQuestions
        ? source.draftIntro
        : (latest?.intro ?? null);

      const created = await prisma.form.create({
        data: {
          name: `Copy of ${source.name}`.slice(0, 120),
          folderPageId: source.folderPageId,
          createdById: userId,
          draftQuestions: questions === null ? undefined : (questions as object),
          draftIntro: intro,
        },
        select: { id: true },
      });
      return { ok: true, formId: created.id };
    }
    case "move-form": {
      const exists = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };
      const folder = await resolveFolderPageId(input.folderPageId);
      if (!folder.ok) return { error: "Folder not found", status: 404 };
      await prisma.form.update({
        where: { id: input.id },
        data: { folderPageId: folder.value },
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

      const validated = validateVersionQuestions(input.questions);
      if (!("ok" in validated)) return validated;

      const last = await prisma.formVersion.findFirst({
        where: { formId: input.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      // Freeze the working copy into a new fillable version and clear the
      // draft — the two happen together so the editor never shows a stale
      // draft alongside the version it just became.
      await prisma.$transaction([
        prisma.formVersion.create({
          data: {
            formId: input.id,
            versionNumber: (last?.versionNumber ?? 0) + 1,
            questions: validated.questions as object,
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
    case "update-version": {
      const version = await prisma.formVersion.findUnique({
        where: { id: input.versionId },
        select: { id: true, formId: true },
      });
      if (!version || version.formId !== input.id)
        return { error: "Version not found", status: 404 };

      const validated = validateVersionQuestions(input.questions);
      if (!("ok" in validated)) return validated;

      // Re-check the lock inside the write so a response landing between the
      // editor load and this save can't be overwritten. The update itself is
      // conditional on still-zero submissions/pins; if the count moved, we bail
      // rather than clobber a version someone already answered.
      try {
        await prisma.$transaction(async (tx) => {
          if (await isFormVersionLocked(input.versionId)) {
            throw new VersionLockedError();
          }
          await tx.formVersion.update({
            where: { id: input.versionId },
            data: {
              questions: validated.questions as object,
              intro: input.description?.trim() || null,
            },
          });
        });
      } catch (e) {
        if (e instanceof VersionLockedError) {
          return {
            error:
              "This version already has responses and can't be edited — save it as a new version instead.",
            status: 409,
          };
        }
        throw e;
      }
      return { ok: true };
    }
    case "delete-version": {
      const version = await prisma.formVersion.findUnique({
        where: { id: input.versionId },
        select: { id: true, formId: true },
      });
      if (!version || version.formId !== input.id)
        return { error: "Version not found", status: 404 };

      try {
        await prisma.$transaction(async (tx) => {
          if (await isFormVersionLocked(input.versionId)) {
            throw new VersionLockedError();
          }
          await tx.formVersion.delete({ where: { id: input.versionId } });
        });
      } catch (e) {
        if (e instanceof VersionLockedError) {
          return {
            error:
              "This version already has responses and can't be deleted.",
            status: 409,
          };
        }
        throw e;
      }
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
    case "update-form-window": {
      const exists = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };
      const opensAt = parseWindowBoundary(input.opensAt);
      const closesAt = parseWindowBoundary(input.closesAt);
      if (opensAt === "invalid" || closesAt === "invalid")
        return { error: "Invalid date", status: 400 };
      if (opensAt && closesAt && closesAt <= opensAt)
        return { error: "Close must be after open.", status: 400 };
      await prisma.form.update({
        where: { id: input.id },
        data: { opensAt, closesAt },
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
          listed: input.listed === "true",
        },
      });
      return { ok: true };
    }
    case "update-form-audience": {
      const exists = await prisma.form.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (!exists) return { error: "Not found", status: 404 };

      let ids: string[] = [];
      if (input.audience === "Groups") {
        const parsed = safeParseJsonString(input.groupIds);
        if (
          !Array.isArray(parsed) ||
          !parsed.every((v): v is string => typeof v === "string")
        ) {
          return { error: "Invalid input", status: 400 };
        }
        ids = [...new Set(parsed)];
        if (ids.length === 0) {
          return { error: "Select at least one group.", status: 400 };
        }
        const [groups, terms] = await Promise.all([
          prisma.groupDefinition.findMany({
            where: { id: { in: ids } },
            select: { id: true, archivedAt: true, boundTermIds: true },
          }),
          prisma.term.findMany({ select: { id: true, endDate: true } }),
        ]);
        const termEndById = new Map(terms.map((t) => [t.id, t.endDate]));
        const now = new Date();
        const usable = new Set(
          groups
            .filter((g) => !isGroupArchived(g, termEndById, now))
            .map((g) => g.id),
        );
        if (ids.some((id) => !usable.has(id))) {
          return {
            error: "One of the selected groups no longer exists or is archived.",
            status: 400,
          };
        }
      }

      // Ids are cleared for non-Groups audiences so stored state stays
      // canonical (toggling away and back means re-selecting).
      await prisma.form.update({
        where: { id: input.id },
        data: { audience: input.audience, audienceGroupIds: ids },
      });
      return { ok: true };
    }
  }
}
