// Templates gallery loader. Templates are the two things you genuinely "start
// something new" from: documents and projects. Email/signing/mentor-note bodies
// are reusable-by-nature objects that live in their own areas (Admin, Core ▸
// Agreements, Mentorship) — they are libraries, not "start from a template"
// surfaces, so they are deliberately not aggregated here.
//   - page    : any lab member (Lab pages flagged isTemplate)
//   - project : Core only (a captured project blueprint)

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

export type TemplateKind = "page" | "project";

// What clicking a template card does. Both kinds "start" a new artifact: a page
// template duplicates into the current scope; a project template opens the
// project create flow prefilled from the blueprint.
export type TemplateAction = "createPage" | "startProject";

export interface TemplateItem {
  id: string;
  kind: TemplateKind;
  name: string;
  description?: string;
  iconEmoji?: string;
  action: TemplateAction;
  // Fallback/target link. For page templates the gallery posts to
  // /api/page-templates; for project templates the card navigates here.
  useHref: string;
  // Lab page templates only: set when this page is the lab-wide default
  // meeting-note template for a meeting type (specs/meeting-notes-model.md
  // §1). Shown as a small chip on the gallery row.
  meetingNoteBadge?: string;
}

export interface TemplatesData {
  items: TemplateItem[];
}

export async function loadTemplates(userId: string): Promise<TemplatesData> {
  const core = await isCore(userId);

  const fetches: Promise<TemplateItem[]>[] = [
    // page — all lab members
    loadPageTemplates(),
  ];
  // project — Core only (matches the projects hub create/capture gating)
  if (core) fetches.push(loadProjectTemplates());

  const groups = await Promise.all(fetches);
  return { items: groups.flat() };
}

// Display label for a page's defaultMeetingNoteFor badge (meetingType names,
// not the "General" wording the design doc used — see Prisma's MeetingType).
const MEETING_NOTE_TYPE_LABEL: Record<string, string> = {
  Team: "Team",
  Partner: "Partner",
  Other: "General",
};

async function loadPageTemplates(): Promise<TemplateItem[]> {
  // Lab-wide document templates: real Page rows flagged isTemplate. These are
  // the shared starter docs any lab member can spin a new document from.
  const rows = await prisma.page.findMany({
    where: {
      workspaceType: "Lab",
      workspaceId: null,
      isTemplate: true,
      archivedAt: null,
      kind: "FreeForm",
    },
    orderBy: { title: "asc" },
    select: { id: true, title: true, iconEmoji: true, defaultMeetingNoteFor: true },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: "page" as const,
    name: r.title,
    iconEmoji: r.iconEmoji ?? undefined,
    action: "createPage" as const,
    // Fallback link (opens the template page). The gallery's "Use" posts to
    // /api/page-templates to duplicate it into the chosen scope.
    useHref: `/documents/${r.id}`,
    meetingNoteBadge: r.defaultMeetingNoteFor
      ? `Meeting notes default · ${MEETING_NOTE_TYPE_LABEL[r.defaultMeetingNoteFor]}`
      : undefined,
  }));
}

async function loadProjectTemplates(): Promise<TemplateItem[]> {
  // Captured project blueprints (epics/sprints/tasks). Clicking "Start" opens
  // the projects hub create flow prefilled with the template (see the `new`
  // query param in projects.hub).
  const rows = await prisma.projectTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, iconEmoji: true },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: "project" as const,
    name: r.name,
    description: r.description ?? undefined,
    iconEmoji: r.iconEmoji ?? undefined,
    action: "startProject" as const,
    useHref: `/projects?new=${r.id}`,
  }));
}
