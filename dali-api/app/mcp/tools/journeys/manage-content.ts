// MCP: manage_journey_page, manage_journey_slides, set_journey_lab and
// set_journey_quiz. Edit what's inside a journey module, saved to the draft.
// Page and slide bodies are written as Markdown. Scope: mcp:write.

import { McpInvalidError, McpNotFoundError, requireForAction } from "../../errors";
import type { McpCtx, McpTool } from "../../registry";
import { createId } from "~/lib/short-id";
import { createPage } from "~/journeys/lib/journey-edit";
import { ENTRY_FILE } from "~/journeys/lib/file-tree";
import type { JourneyContent, JourneyModule, Lab, Quiz, QuizQuestion } from "~/journeys/lib/types";
import {
  applySlideInput,
  markdownToRichDoc,
  SLIDE_INPUT_SCHEMA,
  type SlideInput,
} from "~/components/slides/slide-markdown.server";
import { findModule, insertAt, journeyViewer, moveTo, replaceModule, saveEdit, inputSchema } from "./shared";

const editModule = (moduleId: string, fn: (m: JourneyModule) => JourneyModule | Promise<JourneyModule>) => async (d: JourneyContent) =>
  replaceModule(d, await fn(findModule(d, moduleId)));

function indexOf<T extends { id: string }>(list: T[], id: string, what: string): number {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new McpNotFoundError(`No ${what} ${id} in this module.`);
  return i;
}

// ─── Pages ───────────────────────────────────────────────────────────────────

type PageArgs = {
  action: "add" | "update" | "delete" | "move";
  journeyId: string;
  moduleId: string;
  pageId?: string;
  title?: string;
  markdown?: string;
  index?: number;
  toIndex?: number;
};

export const MANAGE_JOURNEY_PAGE: McpTool = {
  def: {
    name: "manage_journey_page",
    description:
      "Edit a journey module's lesson pages, which learners read in order. Bodies are Markdown (headings, lists, code blocks, quotes, tables, images, links). Actions: add (title, markdown, optional index), update (pageId + title and/or markdown; markdown replaces the whole body), delete, move (pageId + toIndex). Saved to the draft.",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["add", "update", "delete", "move"] },
        journeyId: { type: "string", minLength: 1 },
        moduleId: { type: "string", minLength: 1 },
        pageId: { type: "string", description: "Required except for add." },
        title: { type: "string", maxLength: 300 },
        markdown: { type: "string", maxLength: 300_000 },
        index: { type: "number", minimum: 0, description: "add: position, default last." },
        toIndex: { type: "number", minimum: 0 },
      },
      required: ["action", "journeyId", "moduleId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:write",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as PageArgs;
    requireForAction(args.action, args, { add: ["title"], update: ["pageId"], delete: ["pageId"], move: ["pageId", "toIndex"] });
    const viewer = await journeyViewer(ctx);
    const body = args.markdown !== undefined ? await markdownToRichDoc(args.markdown) : undefined;
    let pageId = args.pageId;
    const result = await saveEdit(
      viewer,
      args.journeyId,
      editModule(args.moduleId, (m) => {
        switch (args.action) {
          case "add": {
            const page = { ...createPage(), title: args.title!, content: body ?? [] };
            pageId = page.id;
            return { ...m, pages: insertAt(m.pages, page, args.index) };
          }
          case "update": {
            const i = indexOf(m.pages, args.pageId!, "page");
            const pages = [...m.pages];
            pages[i] = { ...pages[i], ...(args.title !== undefined ? { title: args.title } : {}), ...(body ? { content: body } : {}) };
            return { ...m, pages };
          }
          case "delete":
            indexOf(m.pages, args.pageId!, "page");
            return { ...m, pages: m.pages.filter((p) => p.id !== args.pageId) };
          case "move":
            return { ...m, pages: moveTo(m.pages, indexOf(m.pages, args.pageId!, "page"), args.toIndex!) };
        }
      }),
    );
    return { ...result, pageId };
  },
};

// ─── Slides ──────────────────────────────────────────────────────────────────

type SlidesArgs = {
  action: "add" | "update" | "delete" | "move" | "set";
  journeyId: string;
  moduleId: string;
  slideId?: string;
  slide?: SlideInput;
  slides?: SlideInput[];
  index?: number;
  toIndex?: number;
};

export const MANAGE_JOURNEY_SLIDES: McpTool = {
  def: {
    name: "manage_journey_slides",
    description:
      "Edit a journey module's slide deck, a short click-through shown beside the lesson. Actions: set (replace the whole deck with `slides`; an empty list removes it), add (`slide`, optional index), update (slideId + `slide` fields to change), delete, move (slideId + toIndex). Saved to the draft.",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["add", "update", "delete", "move", "set"] },
        journeyId: { type: "string", minLength: 1 },
        moduleId: { type: "string", minLength: 1 },
        slideId: { type: "string" },
        slide: SLIDE_INPUT_SCHEMA,
        slides: { type: "array", items: SLIDE_INPUT_SCHEMA, maxItems: 100 },
        index: { type: "number", minimum: 0 },
        toIndex: { type: "number", minimum: 0 },
      },
      required: ["action", "journeyId", "moduleId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:write",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as SlidesArgs;
    requireForAction(args.action, args, {
      set: ["slides"],
      add: ["slide"],
      update: ["slideId", "slide"],
      delete: ["slideId"],
      move: ["slideId", "toIndex"],
    });
    const viewer = await journeyViewer(ctx);
    let slideId = args.slideId;
    const result = await saveEdit(
      viewer,
      args.journeyId,
      editModule(args.moduleId, async (m) => {
        const slides = m.slides ?? [];
        const withSlides = (next: typeof slides) => ({ ...m, slides: next.length ? next : undefined });
        switch (args.action) {
          case "set": {
            const next = [];
            for (const input of args.slides!) next.push(await applySlideInput(input));
            return withSlides(next);
          }
          case "add": {
            const slide = await applySlideInput(args.slide!);
            slideId = slide.id;
            return withSlides(insertAt(slides, slide, args.index));
          }
          case "update": {
            const i = indexOf(slides, args.slideId!, "slide");
            const next = [...slides];
            next[i] = await applySlideInput(args.slide!, slides[i]);
            return withSlides(next);
          }
          case "delete":
            indexOf(slides, args.slideId!, "slide");
            return withSlides(slides.filter((s) => s.id !== args.slideId));
          case "move":
            return withSlides(moveTo(slides, indexOf(slides, args.slideId!, "slide"), args.toIndex!));
        }
      }),
    );
    return { ...result, slideId };
  },
};

// ─── Lab ─────────────────────────────────────────────────────────────────────

type LabInput = {
  title: string;
  intro?: string;
  files: Record<string, string>;
  defaultFile?: string;
  steps: { title: string; instructions?: string; hint?: string; check: string }[];
};

export const SET_JOURNEY_LAB: McpTool = {
  def: {
    name: "set_journey_lab",
    description:
      "Set or remove a journey module's coding lab: a small web project learners edit in the browser while guided steps check their work. `files` maps paths to contents and must include index.html (local stylesheets and scripts are inlined; <script type=\"module\"> files can import each other, and bare imports load from esm.sh). Each step's `check` is a JavaScript expression evaluated in the learner's page that is true once the step is done, e.g. document.querySelector('h1')?.textContent.includes('Hello'). Replaces the whole lab. Pass remove: true to delete it. Saved to the draft.",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: {
        journeyId: { type: "string", minLength: 1 },
        moduleId: { type: "string", minLength: 1 },
        remove: { type: "boolean" },
        lab: {
          type: "object",
          properties: {
            title: { type: "string", maxLength: 300 },
            intro: { type: "string", maxLength: 20_000, description: "Wrap text in backticks for inline code." },
            files: { type: "object", description: "Path to file contents." },
            defaultFile: { type: "string", description: "The file learners start in." },
            steps: {
              type: "array",
              maxItems: 50,
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  instructions: { type: "string" },
                  hint: { type: "string" },
                  check: { type: "string" },
                },
                required: ["title", "check"],
                additionalProperties: false,
              },
            },
          },
          required: ["title", "files", "steps"],
          additionalProperties: false,
        },
      },
      required: ["journeyId", "moduleId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:write",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as { journeyId: string; moduleId: string; remove?: boolean; lab?: LabInput };
    if (!args.remove && !args.lab) throw new McpInvalidError("Pass lab, or remove: true.");
    if (args.lab && !(ENTRY_FILE in args.lab.files)) throw new McpInvalidError(`The lab needs an ${ENTRY_FILE} file.`);
    const refuseIfStudio = (m: JourneyModule) => {
      if (args.lab && m.studio) throw new McpInvalidError("This module has a whiteboard or document lab. Remove it with set_journey_studio_lab first.");
    };
    const viewer = await journeyViewer(ctx);
    const lab: Lab | undefined = args.lab && {
      title: args.lab.title,
      intro: args.lab.intro ?? "",
      files: args.lab.files,
      defaultFile: args.lab.defaultFile,
      steps: args.lab.steps.map((s) => ({
        id: createId("step"),
        title: s.title,
        instructions: s.instructions ?? "",
        hint: s.hint || undefined,
        check: s.check,
      })),
    };
    return saveEdit(
      viewer,
      args.journeyId,
      editModule(args.moduleId, (m) => {
        refuseIfStudio(m);
        return { ...m, lab: args.remove ? undefined : lab };
      }),
    );
  },
};

// ─── Quiz ────────────────────────────────────────────────────────────────────

type QuestionInput =
  | { type: "multiple-choice"; prompt: string; options: string[]; correctOption: number; explanation?: string }
  | { type: "short-answer"; prompt: string; acceptedAnswers?: string[]; explanation?: string };

function toQuestion(q: QuestionInput, n: number): QuizQuestion {
  const id = createId("q");
  if (q.type === "short-answer") {
    return { id, type: q.type, prompt: q.prompt, acceptedAnswers: q.acceptedAnswers?.length ? q.acceptedAnswers : [""], explanation: q.explanation };
  }
  const texts = q.options ?? [];
  if (texts.length < 2) throw new McpInvalidError(`Question ${n}: multiple choice needs at least two options.`);
  if (!Number.isInteger(q.correctOption) || q.correctOption < 0 || q.correctOption >= texts.length) {
    throw new McpInvalidError(`Question ${n}: correctOption must be the index of one of its options.`);
  }
  const options = texts.map((text) => ({ id: createId("opt"), text }));
  return { id, type: q.type, prompt: q.prompt, options, correctOptionId: options[q.correctOption].id, explanation: q.explanation };
}

export const SET_JOURNEY_QUIZ: McpTool = {
  def: {
    name: "set_journey_quiz",
    description:
      "Set or remove a journey module's quiz. Learners must reach passingScore (percent correct) to finish the module, and can retry. multiple-choice questions take options (strings) and correctOption (0-based index); short-answer questions take acceptedAnswers, matched ignoring case, extra spaces and trailing punctuation (leave it empty to accept any response, for reflection questions). Replaces the whole quiz. Pass remove: true to delete it. Saved to the draft.",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: {
        journeyId: { type: "string", minLength: 1 },
        moduleId: { type: "string", minLength: 1 },
        remove: { type: "boolean" },
        quiz: {
          type: "object",
          properties: {
            title: { type: "string", maxLength: 300 },
            intro: { type: "string", maxLength: 20_000 },
            passingScore: { type: "number", minimum: 0, maximum: 100, description: "Default 80." },
            questions: {
              type: "array",
              maxItems: 100,
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["multiple-choice", "short-answer"] },
                  prompt: { type: "string" },
                  options: { type: "array", items: { type: "string" } },
                  correctOption: { type: "number" },
                  acceptedAnswers: { type: "array", items: { type: "string" } },
                  explanation: { type: "string" },
                },
                required: ["type", "prompt"],
                additionalProperties: false,
              },
            },
          },
          required: ["title", "questions"],
          additionalProperties: false,
        },
      },
      required: ["journeyId", "moduleId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:write",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as {
      journeyId: string;
      moduleId: string;
      remove?: boolean;
      quiz?: { title: string; intro?: string; passingScore?: number; questions: QuestionInput[] };
    };
    if (!args.remove && !args.quiz) throw new McpInvalidError("Pass quiz, or remove: true.");
    const viewer = await journeyViewer(ctx);
    const quiz: Quiz | undefined = args.quiz && {
      title: args.quiz.title,
      intro: args.quiz.intro ?? "",
      passingScore: Math.round(args.quiz.passingScore ?? 80),
      questions: args.quiz.questions.map((q, i) => toQuestion(q, i + 1)),
    };
    return saveEdit(viewer, args.journeyId, editModule(args.moduleId, (m) => ({ ...m, quiz: args.remove ? undefined : quiz })));
  },
};
