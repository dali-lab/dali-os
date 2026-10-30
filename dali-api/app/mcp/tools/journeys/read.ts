// MCP: list_journeys, get_journey. Read the onboarding journeys a member can
// see; editors also see drafts. Lesson pages and slide bodies come back as
// Markdown. Scope: mcp:read.

import { McpForbiddenError, McpInvalidError, McpNotFoundError } from "../../errors";
import type { McpCtx, McpTool } from "../../registry";
import { findDomain, listViewerJourneys, loadJourneyById } from "~/journeys/lib/journeys.server";
import { getJourneyProgress, sameContent } from "~/journeys/lib/journey";
import { validateJourney } from "~/journeys/lib/journey-validation";
import { editPath, journeyPath } from "~/journeys/lib/paths";
import type { JourneyContent } from "~/journeys/lib/types";
import { richDocToMarkdown, slideToOutput } from "~/components/slides/slide-markdown.server";
import { journeyViewer, inputSchema } from "./shared";

export const LIST_JOURNEYS: McpTool = {
  def: {
    name: "list_journeys",
    description:
      "List onboarding journeys (self-paced learning paths per domain) the caller can see: published ones, plus drafts they can edit. Shows each journey's domain, the caller's role (owner, editor or none), whether it has unpublished changes, and the caller's own progress. Filter with `domain` (a domain code such as fullstack).",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: { domain: { type: "string", description: "Domain code, e.g. fullstack or uiux." } },
      additionalProperties: false,
    }),
    requiredScope: "mcp:read",
  },
  run: async (ctx: McpCtx, args) => {
    const viewer = await journeyViewer(ctx);
    const domainArg = typeof args.domain === "string" ? args.domain : undefined;
    const domain = domainArg ? await findDomain(domainArg) : null;
    if (domainArg && !domain) throw new McpNotFoundError(`No domain ${domainArg}.`);
    const journeys = await listViewerJourneys(viewer, domain ? { domainId: domain.id } : {});
    return {
      journeys: journeys.map((j) => {
        const shown = (j.published ?? j.draft) as JourneyContent;
        const progress = j.published && j.completed ? getJourneyProgress(j.published, new Set(j.completed)) : null;
        return {
          id: j.id,
          title: shown.title,
          description: shown.description,
          domain: j.domain,
          role: j.role,
          isPublished: j.published !== null,
          hasUnpublishedChanges: j.draft ? !j.published || !sameContent(j.draft, j.published) : undefined,
          modules: shown.modules.length,
          progress: progress ? { ...progress, started: true } : null,
          url: journeyPath(j.domain.slug, j.id),
          ...(j.role ? { editUrl: editPath(j.domain.slug, j.id) } : {}),
        };
      }),
      canCreateIn: viewer.isCore ? "any domain" : viewer.leadDomainIds.length ? "the domains you lead" : "none",
    };
  },
};

async function moduleDetail(m: JourneyContent["modules"][number], full: boolean) {
  const base = {
    id: m.id,
    title: m.title,
    summary: m.summary,
    duration: m.duration,
    dependsOn: m.dependsOn,
    position: m.position,
  };
  if (!full) {
    return {
      ...base,
      pages: m.pages.map((p) => ({ id: p.id, title: p.title })),
      slides: m.slides?.length ?? 0,
      lab: m.lab ? { title: m.lab.title, steps: m.lab.steps.length, files: Object.keys(m.lab.files) } : null,
      studioLab: m.studio ? { kind: m.studio.kind, title: m.studio.title, criteria: m.studio.criteria.length } : null,
      quiz: m.quiz ? { title: m.quiz.title, questions: m.quiz.questions.length } : null,
    };
  }
  const pages = [];
  for (const p of m.pages) pages.push({ id: p.id, title: p.title, markdown: await richDocToMarkdown(p.content) });
  const slides = [];
  for (const s of m.slides ?? []) slides.push(await slideToOutput(s));
  const studioLab = m.studio
    ? {
        ...m.studio,
        document: m.studio.document ? { templateMarkdown: await richDocToMarkdown(m.studio.document.template) } : undefined,
      }
    : null;
  return { ...base, pages, slides, lab: m.lab ?? null, studioLab, quiz: m.quiz ?? null };
}

export const GET_JOURNEY: McpTool = {
  def: {
    name: "get_journey",
    description:
      "Read one onboarding journey. `version` draft (editors only, the default for them) or published. `detail` outline (module graph, page titles, counts) or full (page bodies and slide bodies as Markdown, lab files and steps, whiteboard and document labs with their checks, quiz questions with answers; full is editors only). With full, pass `moduleId` to expand only that module and keep the others as outline, which keeps a large journey readable one module at a time. Also returns what still blocks publishing.",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: {
        journeyId: { type: "string", minLength: 1 },
        version: { type: "string", enum: ["draft", "published"] },
        detail: { type: "string", enum: ["outline", "full"], description: "Default outline." },
        moduleId: { type: "string", minLength: 1, description: "With detail full: expand only this module. Other modules stay outline." },
      },
      required: ["journeyId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:read",
  },
  run: async (ctx: McpCtx, args) => {
    const viewer = await journeyViewer(ctx);
    const j = await loadJourneyById(viewer, String(args.journeyId));
    if (!j) throw new McpNotFoundError("Journey not found.");
    const wantDraft = args.version ? args.version === "draft" : j.role !== null;
    if ((wantDraft || args.detail === "full") && !j.role) {
      throw new McpForbiddenError("Only the journey's owners and editors can read its draft or full content.");
    }
    const shown = (wantDraft ? j.draft : j.published) as JourneyContent | null;
    if (!shown) throw new McpNotFoundError("This journey hasn't been published yet.");
    const full = args.detail === "full";
    const moduleId = typeof args.moduleId === "string" ? args.moduleId : undefined;
    if (moduleId && !full) throw new McpInvalidError("moduleId requires detail full.");
    if (moduleId && !shown.modules.some((m) => m.id === moduleId)) throw new McpNotFoundError("Module not found.");
    const modules = [];
    for (const m of shown.modules) modules.push(await moduleDetail(m, full && (!moduleId || m.id === moduleId)));
    return {
      id: j.id,
      domain: j.domain,
      version: wantDraft ? "draft" : "published",
      role: j.role,
      title: shown.title,
      description: shown.description,
      recommended: Boolean(shown.recommended),
      modules,
      ...(j.role ? { publishIssues: validateJourney(shown).map((i) => i.message) } : {}),
      url: journeyPath(j.domain.slug, j.id),
    };
  },
};
