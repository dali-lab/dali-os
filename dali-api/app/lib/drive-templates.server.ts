// Aggregated templates loader for the Drive "Templates" lens.
// Normalises five existing template systems into one TemplateItem[] without
// any new storage.  Access is gated per-kind:
//   - page        : any lab member (PageTemplate rows are lab-wide)
//   - form        : canViewForms (Core / Admin / Instructor) — forms with an
//                   active draft are shown as "in-progress templates"
//   - mentorNote  : canViewMentorship (Core / lab mentor)
//   - email       : Core only (authored in Admin)
//   - signing     : Core only (authored in Admin)

import { prisma } from "~/lib/db";
import { Prisma } from "~/generated/prisma/client";
import { isCore, canViewForms } from "~/lib/roles";
import { canViewMentorship } from "~/mentorship/lib/visibility";

export type TemplateKind = "page" | "form" | "mentorNote" | "email" | "signing";

export interface TemplateItem {
  id: string;
  kind: TemplateKind;
  name: string;
  description?: string;
  // Where to go when the viewer clicks "Use". For kinds where a real
  // create-from-template flow doesn't yet exist we link to the manager.
  useHref: string;
}

export interface TemplatesData {
  items: TemplateItem[];
  // Booleans so the UI can omit category headings for kinds the viewer cannot
  // see at all, without the client doing its own role logic.
  canSeeForm: boolean;
  canSeeMentorNote: boolean;
  canSeeEmailAndSigning: boolean;
}

export async function loadTemplates(userId: string): Promise<TemplatesData> {
  const [core, viewForms, viewMentorship] = await Promise.all([
    isCore(userId),
    canViewForms(userId),
    canViewMentorship(userId),
  ]);

  const fetches: Promise<TemplateItem[]>[] = [
    // page — all lab members
    loadPageTemplates(),
  ];

  if (viewForms) fetches.push(loadFormDraftTemplates());
  if (viewMentorship) fetches.push(loadMentorNoteTemplates());
  if (core) {
    fetches.push(loadEmailTemplates());
    fetches.push(loadSigningDocuments());
  }

  const groups = await Promise.all(fetches);
  const items = groups.flat();

  return {
    items,
    canSeeForm: viewForms,
    canSeeMentorNote: viewMentorship,
    canSeeEmailAndSigning: core,
  };
}

async function loadPageTemplates(): Promise<TemplateItem[]> {
  const rows = await prisma.pageTemplate.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: "page" as const,
    name: r.name,
    description: r.description ?? undefined,
    // No dedicated create-from-PageTemplate UI exists today; link to the
    // Documents hub where the user can browse/pick templates from the picker.
    useHref: "/documents",
  }));
}

async function loadFormDraftTemplates(): Promise<TemplateItem[]> {
  // Forms with an active draft are the closest thing to "form templates" —
  // they're typically base forms used to spin off variations via duplicate.
  const rows = await prisma.form.findMany({
    where: { draftQuestions: { not: Prisma.JsonNull } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: "form" as const,
    name: r.name,
    // "Use" = open the form editor where the user can duplicate it.
    useHref: `/forms/${r.id}`,
  }));
}

async function loadMentorNoteTemplates(): Promise<TemplateItem[]> {
  const rows = await prisma.mentorNoteTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: "mentorNote" as const,
    name: r.name,
    // No direct "use this template" URL exists; the template is auto-applied
    // when a mentor creates a new note. Link to the mentorship hub.
    useHref: "/mentorship",
  }));
}

async function loadEmailTemplates(): Promise<TemplateItem[]> {
  const rows = await prisma.emailTemplate.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: "email" as const,
    name: r.name,
    useHref: `/admin/email-templates/${r.id}`,
  }));
}

async function loadSigningDocuments(): Promise<TemplateItem[]> {
  const rows = await prisma.signingDocument.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: "signing" as const,
    name: r.name,
    useHref: `/admin/agreements/${r.id}`,
  }));
}
