// Whiteboard and document labs on journey modules, and mentor review of
// learners' work on them. Document bodies are Markdown.

import { McpInvalidError, McpNotFoundError } from "../../errors";
import type { McpCtx, McpTool } from "../../registry";
import { createId } from "~/lib/short-id";
import { markdownToRichDoc, richDocToMarkdown } from "~/components/slides/slide-markdown.server";
import { evaluateCriteria, foundHotspots } from "~/journeys/lib/studio";
import { studioLabSchema } from "~/journeys/lib/studio-schema";
import { listReviewIds, loadReviewEntries, reviewSubmission } from "~/journeys/lib/studio.server";
import type { StudioLab } from "~/journeys/lib/studio-types";
import { pageArray, pageProps, type PageArgs } from "../../pagination";
import { findModule, inputSchema, journeyViewer, replaceModule, saveEdit, unwrap } from "./shared";

const REVIEW_PAGE_LIMITS = { defaultLimit: 50, maxLimit: 200 };

export const RULE_HELP =
  "Automatic rules: item-count {itemType: sticky|text|shape|image|pin|any, color?, min} counts the learner's own board items; hotspots {min} counts hidden problem areas the learner pinned; contains-text {text}; word-count {min}; section {heading, minWords} counts words between a heading containing that text and the next heading; list-items {heading, min} counts list items in that section.";

type StudioInput = {
  kind: "canvas" | "document";
  title: string;
  brief?: string;
  criteria: { id?: string; label: string; description?: string; mode: "auto" | "self" | "mentor"; rule?: Record<string, unknown> }[];
  canvas?: { items?: Record<string, unknown>[]; hotspots?: Record<string, unknown>[] };
  documentTemplateMarkdown?: string;
};

async function toStudio(input: StudioInput): Promise<StudioLab> {
  const withId = (prefix: string) => (x: Record<string, unknown>) => ({ ...x, id: typeof x.id === "string" && x.id ? x.id : createId(prefix) });
  const candidate = {
    kind: input.kind,
    title: input.title,
    brief: input.brief ?? "",
    criteria: input.criteria.map(withId("crit")),
    ...(input.kind === "canvas"
      ? { canvas: { items: (input.canvas?.items ?? []).map(withId("item")), hotspots: (input.canvas?.hotspots ?? []).map(withId("hotspot")) } }
      : { document: { template: await markdownToRichDoc(input.documentTemplateMarkdown ?? "") } }),
  };
  const parsed = studioLabSchema.safeParse(candidate);
  if (!parsed.success) throw new McpInvalidError(`That lab couldn't be read: ${parsed.error.issues[0]?.message ?? "invalid shape"}.`);
  return parsed.data as unknown as StudioLab;
}

export const SET_JOURNEY_STUDIO_LAB: McpTool = {
  def: {
    name: "set_journey_studio_lab",
    description:
      `Set or remove a journey module's whiteboard (kind canvas) or document (kind document) lab, for non-code work like critiques, affinity maps and ticket writing. Each criterion is checked automatically (mode auto, with a rule), ticked by the learner (self), or approved by a journey owner or editor after the learner submits (mentor). ${RULE_HELP} Canvas labs take a starter board: items {type: sticky|text|shape|image|pin, x, y, width?, height?, text?, color: yellow|pink|green|blue|purple, src?, alt?, locked?} and hidden hotspots {label, x, y, width, height} learners should pin. Document labs take a starter template in Markdown (use ### headings for the sections rules look for). A module has one lab: remove a code lab with set_journey_lab first. Replaces the whole lab. Pass remove: true to delete it. Saved to the draft.`,
    inputSchema: inputSchema({
      type: "object",
      properties: {
        journeyId: { type: "string", minLength: 1 },
        moduleId: { type: "string", minLength: 1 },
        remove: { type: "boolean" },
        lab: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["canvas", "document"] },
            title: { type: "string", maxLength: 300 },
            brief: { type: "string", maxLength: 20_000, description: "Plain text. Blank lines separate paragraphs." },
            criteria: { type: "array", maxItems: 50, items: { type: "object" } },
            canvas: { type: "object", description: "{ items: [...], hotspots: [...] }" },
            documentTemplateMarkdown: { type: "string", maxLength: 100_000 },
          },
          required: ["kind", "title", "criteria"],
        },
      },
      required: ["journeyId", "moduleId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:write",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as { journeyId: string; moduleId: string; remove?: boolean; lab?: StudioInput };
    if (!args.remove && !args.lab) throw new McpInvalidError("Pass lab, or remove: true.");
    const viewer = await journeyViewer(ctx);
    const studio = args.lab ? await toStudio(args.lab) : undefined;
    return saveEdit(viewer, args.journeyId, (d) => {
      const m = findModule(d, args.moduleId);
      if (studio && m.lab) throw new McpInvalidError("This module has a code lab. Remove it with set_journey_activity (activity code_lab, remove: true) first.");
      return replaceModule(d, { ...m, studio: args.remove ? undefined : studio });
    });
  },
};

type ReviewListArgs = PageArgs & { status?: "waiting" | "reviewed" };

export const LIST_JOURNEY_REVIEWS: McpTool = {
  def: {
    name: "list_journey_reviews",
    description:
      "List learners' whiteboard and document lab submissions on onboarding journeys you own or edit, newest first. status is waiting (the default) or reviewed. Page with page.nextCursor as cursor until page.hasMore is false. Read one with get_journey_review.",
    inputSchema: inputSchema({
      type: "object",
      properties: {
        status: { type: "string", enum: ["waiting", "reviewed"] },
        ...pageProps(REVIEW_PAGE_LIMITS),
      },
      additionalProperties: false,
    }),
    requiredScope: "mcp:read",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as ReviewListArgs;
    const viewer = await journeyViewer(ctx);
    const ids = await listReviewIds(viewer, args.status ?? "waiting");
    const { rows, page } = pageArray(ids, args, REVIEW_PAGE_LIMITS);
    const entries = await loadReviewEntries(viewer, rows);
    return {
      submissions: entries.map((e) => ({
        submissionId: e.submission.id,
        learner: e.learner.name,
        lab: e.studio.title,
        kind: e.studio.kind,
        module: e.moduleTitle,
        journey: e.journeyTitle,
        status: e.submission.status,
        submittedAt: e.submission.submittedAt,
      })),
      page,
    };
  },
};

export const GET_JOURNEY_REVIEW: McpTool = {
  def: {
    name: "get_journey_review",
    description:
      "Read one learner's whiteboard or document lab submission on a journey you own or edit: the work as text, every check's result, and which hidden problem areas they found.",
    inputSchema: inputSchema({
      type: "object",
      properties: { submissionId: { type: "string", minLength: 1 } },
      required: ["submissionId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:read",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as { submissionId: string };
    const viewer = await journeyViewer(ctx);
    const [entry] = await loadReviewEntries(viewer, [args.submissionId]);
    if (!entry) throw new McpNotFoundError("Submission not found.");
    const { submission: s, studio } = entry;
    const results = evaluateCriteria(studio, s.work, s.selfChecks, s.mentorChecks, s.status);
    const found = foundHotspots(studio, s.work);
    return {
      submissionId: s.id,
      learner: entry.learner.name,
      lab: studio.title,
      kind: studio.kind,
      status: s.status,
      checks: results.map((r) => ({ criterionId: r.criterion.id, label: r.criterion.label, mode: r.criterion.mode, state: r.state, detail: r.detail })),
      work:
        studio.kind === "canvas"
          ? (s.work.items ?? []).filter((i) => !i.fromStarter).map((i) => ({ type: i.type, color: i.color, text: i.text, x: i.x, y: i.y }))
          : await richDocToMarkdown(s.work.doc),
      hotspots: (studio.canvas?.hotspots ?? []).map((h) => ({ label: h.label, found: found.has(h.id) })),
      mentorNote: s.mentorNote,
      reviewer: s.reviewerName,
    };
  },
};

type ReviewArgs = {
  submissionId: string;
  decision: "approved" | "changes-requested";
  note?: string;
  mentorChecks?: Record<string, boolean>;
};

export const REVIEW_JOURNEY_SUBMISSION: McpTool = {
  def: {
    name: "review_journey_submission",
    description:
      "Approve a learner's whiteboard or document lab submission, or send it back. decision is approved or changes-requested. mentorChecks ticks mentor criteria by id ({criterionId: true}); approving needs every mentor criterion ticked, requesting changes needs a note. The learner is notified.",
    inputSchema: inputSchema({
      type: "object",
      properties: {
        submissionId: { type: "string", minLength: 1 },
        decision: { type: "string", enum: ["approved", "changes-requested"] },
        note: { type: "string", maxLength: 10_000 },
        mentorChecks: { type: "object" },
      },
      required: ["submissionId", "decision"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:write",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as ReviewArgs;
    const viewer = await journeyViewer(ctx);
    unwrap(await reviewSubmission(viewer, args.submissionId, { mentorChecks: args.mentorChecks ?? {}, note: args.note ?? "", decision: args.decision }));
    return { ok: true, submissionId: args.submissionId, decision: args.decision };
  },
};
