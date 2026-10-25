// MCP: manage_journey and manage_journey_module. Create and shape onboarding
// journeys: the journey itself (details, publish, discard, delete) and its
// modules on the prerequisite map. Scope: mcp:write.

import { McpInvalidError, McpNotFoundError, requireForAction } from "../../errors";
import type { McpCtx, McpTool } from "../../registry";
import {
  createJourney,
  deleteJourney,
  discardDraft,
  findDomain,
  loadJourneyById,
  publishJourney,
} from "~/journeys/lib/journeys.server";
import { validateJourney } from "~/journeys/lib/journey-validation";
import { canAddDependency, createModule, removeModule } from "~/journeys/lib/journey-edit";
import type { JourneyContent, JourneyModule } from "~/journeys/lib/types";
import { findModule, journeyLinks, journeyViewer, replaceModule, saveEdit, unwrap, inputSchema } from "./shared";

type JourneyArgs = {
  action: "create" | "update" | "publish" | "discard" | "delete";
  journeyId?: string;
  domain?: string;
  title?: string;
  description?: string;
  recommended?: boolean;
};

export const MANAGE_JOURNEY: McpTool = {
  def: {
    name: "manage_journey",
    description:
      "Create and manage onboarding journeys. Actions: create (domain code, optional title/description; starts as a private draft you own, with one Welcome module), update (title, description, recommended), publish (makes the current draft live for learners; fails while publishIssues remain), discard (drops unpublished changes; a never-published journey is deleted, owners only), delete (owners only; removes learner progress too). Core can create in any domain, domain leads in the domains they lead. Edit modules with manage_journey_module, pages with manage_journey_page, slides with manage_journey_slides, labs with set_journey_lab, quizzes with set_journey_quiz, and access with manage_journey_access.",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["create", "update", "publish", "discard", "delete"] },
        journeyId: { type: "string", description: "Required except for create." },
        domain: { type: "string", description: "create: domain code, e.g. fullstack." },
        title: { type: "string", maxLength: 300 },
        description: { type: "string", maxLength: 20_000 },
        recommended: { type: "boolean", description: "Feature it at the top of the domain for new members." },
      },
      required: ["action"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:write",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as JourneyArgs;
    requireForAction(args.action, args, {
      create: ["domain"],
      update: ["journeyId"],
      publish: ["journeyId"],
      discard: ["journeyId"],
      delete: ["journeyId"],
    });
    const viewer = await journeyViewer(ctx);
    const details = (d: JourneyContent): JourneyContent => ({
      ...d,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.recommended !== undefined ? { recommended: args.recommended || undefined } : {}),
    });

    switch (args.action) {
      case "create": {
        const domain = await findDomain(args.domain!);
        if (!domain) throw new McpNotFoundError(`No domain ${args.domain}.`);
        const { id } = unwrap(await createJourney(viewer, domain.id));
        if (args.title === undefined && args.description === undefined && args.recommended === undefined) {
          return { ok: true, journeyId: id, ...(await journeyLinks(id)) };
        }
        return saveEdit(viewer, id, details);
      }
      case "update":
        return saveEdit(viewer, args.journeyId!, details);
      case "publish": {
        const j = await loadJourneyById(viewer, args.journeyId!);
        if (!j?.draft || !j.version) throw new McpNotFoundError("Journey not found.");
        const issues = validateJourney(j.draft).map((i) => i.message);
        if (issues.length) throw new McpInvalidError(`Fix these before publishing: ${issues.join(" ")}`);
        const { version } = unwrap(await publishJourney(viewer, j.id, j.draft, j.version));
        return { ok: true, journeyId: j.id, version, published: true, ...(await journeyLinks(j.id)) };
      }
      case "discard": {
        const result = unwrap(await discardDraft(viewer, args.journeyId!));
        return { ok: true, journeyId: args.journeyId, deleted: result.deleted };
      }
      case "delete":
        unwrap(await deleteJourney(viewer, args.journeyId!));
        return { ok: true, journeyId: args.journeyId, deleted: true };
    }
  },
};

type ModuleArgs = {
  action: "add" | "update" | "delete" | "set_prerequisites";
  journeyId: string;
  moduleId?: string;
  title?: string;
  summary?: string;
  duration?: string;
  afterModuleId?: string;
  dependsOn?: string[];
  position?: { x: number; y: number };
};

/** Replaces a module's prerequisites, refusing unknown modules and cycles. */
function setPrerequisites(draft: JourneyContent, moduleId: string, dependsOn: string[]): JourneyContent {
  const cleared = replaceModule(draft, { ...findModule(draft, moduleId), dependsOn: [] });
  return [...new Set(dependsOn)].reduce((d, prereq) => {
    if (!canAddDependency(d, moduleId, prereq)) {
      throw new McpInvalidError(`${prereq} can't be a prerequisite of ${moduleId}: it doesn't exist or would make a loop.`);
    }
    const mod = findModule(d, moduleId);
    return replaceModule(d, { ...mod, dependsOn: [...mod.dependsOn, prereq] });
  }, cleared);
}

export const MANAGE_JOURNEY_MODULE: McpTool = {
  def: {
    name: "manage_journey_module",
    description:
      "Add, update or delete modules on an onboarding journey's map (saved to the draft). A module unlocks once every module in its dependsOn is finished; modules with no prerequisites are starting points. Actions: add (title, summary, duration like \"20 min\"; afterModuleId places it after that module and makes it the prerequisite, or pass dependsOn), update (any of title, summary, duration, position {x,y}), delete (also removes it from other modules' prerequisites), set_prerequisites (moduleId + the full dependsOn list; loops are refused). New modules start with one empty page.",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["add", "update", "delete", "set_prerequisites"] },
        journeyId: { type: "string", minLength: 1 },
        moduleId: { type: "string", description: "Required except for add." },
        title: { type: "string", maxLength: 300 },
        summary: { type: "string", maxLength: 20_000 },
        duration: { type: "string", maxLength: 40 },
        afterModuleId: { type: "string" },
        dependsOn: { type: "array", items: { type: "string" } },
        position: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
          additionalProperties: false,
        },
      },
      required: ["action", "journeyId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:write",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as ModuleArgs;
    requireForAction(args.action, args, {
      add: [],
      update: ["moduleId"],
      delete: ["moduleId"],
      set_prerequisites: ["moduleId", "dependsOn"],
    });
    const viewer = await journeyViewer(ctx);
    const patch = (m: JourneyModule): JourneyModule => ({
      ...m,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.summary !== undefined ? { summary: args.summary } : {}),
      ...(args.duration !== undefined ? { duration: args.duration } : {}),
      ...(args.position ? { position: args.position } : {}),
    });

    switch (args.action) {
      case "add": {
        let moduleId = "";
        return saveEdit(viewer, args.journeyId, (d) => {
          if (args.afterModuleId) findModule(d, args.afterModuleId);
          const mod = patch(createModule(d, args.afterModuleId ?? null));
          moduleId = mod.id;
          const added = { ...d, modules: [...d.modules, mod] };
          return args.dependsOn ? setPrerequisites(added, mod.id, args.dependsOn) : added;
        }).then((r) => ({ ...r, moduleId }));
      }
      case "update":
        return saveEdit(viewer, args.journeyId, (d) => replaceModule(d, patch(findModule(d, args.moduleId!))));
      case "delete":
        return saveEdit(viewer, args.journeyId, (d) => {
          findModule(d, args.moduleId!);
          return removeModule(d, args.moduleId!);
        });
      case "set_prerequisites":
        return saveEdit(viewer, args.journeyId, (d) => setPrerequisites(d, args.moduleId!, args.dependsOn!));
    }
  },
};
