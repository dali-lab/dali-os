import { prisma } from "~/lib/db.server";
import { currentTerm, isCore } from "~/lib/roles";
import { MILESTONE_KINDS, type MilestoneKind } from "~/core/lib/milestones";
import {
  MilestoneError,
  createMilestone,
  deleteMilestone,
  fillTermFromLastYear,
  getTermMilestones,
  moveMilestone,
  updateMilestone,
} from "~/core/lib/milestones.server";
import { McpForbiddenError, McpInvalidError, McpNotFoundError, requireForAction } from "../errors";
import type { McpCtx, McpTool } from "../registry";

export const LIST_CORE_MILESTONES_TOOL = {
  name: "list_core_milestones",
  description:
    "List Core's term plan: for each week 0 to 10 of a term, its milestones (lab-wide goals) and plan items (things to do), in order, with owners and notes. Core only. termCode like '26F' defaults to the current term. kind filters to Milestone or Plan.",
  inputSchema: {
    type: "object" as const,
    properties: {
      termCode: { type: "string", description: "Term code such as 26F. Defaults to the current term." },
      kind: { type: "string", enum: [...MILESTONE_KINDS] },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

const WRITE_ACTIONS = ["create", "update", "move", "delete", "fill_from_last_year"] as const;

export const MANAGE_CORE_MILESTONE_TOOL = {
  name: "manage_core_milestone",
  description:
    "Create and manage Core milestones and plan items. Core only. Actions: create (termId, week 0-10, title; optional kind, notes, ownerIds), update (id; optional title, notes, ownerIds, kind; an empty title deletes), move (id, toWeek; optional toPosition), delete (id), fill_from_last_year (termId; copies last year's same-season term into weeks that have no items). Owners must be Core members for that term; no owners means the whole lab.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: [...WRITE_ACTIONS] },
      id: { type: "string" },
      termId: { type: "string" },
      week: { type: "integer", minimum: 0, maximum: 10 },
      toWeek: { type: "integer", minimum: 0, maximum: 10 },
      toPosition: { type: "integer", minimum: 0 },
      kind: { type: "string", enum: [...MILESTONE_KINDS] },
      title: { type: "string" },
      notes: { type: "string" },
      ownerIds: { type: "array", items: { type: "string" } },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

async function requireCoreCaller(ctx: McpCtx) {
  if (!(await isCore(ctx.user.id))) throw new McpForbiddenError("Only Core members can use the milestones");
}

async function resolveTermId(code: string | undefined): Promise<{ id: string; code: string }> {
  if (code) {
    const term = await prisma.term.findUnique({ where: { code: code.toUpperCase() }, select: { id: true, code: true } });
    if (!term) throw new McpNotFoundError(`Term ${code} not found`);
    return term;
  }
  const current = await currentTerm();
  if (!current) throw new McpNotFoundError("No current term");
  return { id: current.id, code: current.code };
}

function asKind(value: unknown): MilestoneKind | undefined {
  if (value === undefined) return undefined;
  if (!MILESTONE_KINDS.includes(value as MilestoneKind)) throw new McpInvalidError("kind must be Milestone or Plan");
  return value as MilestoneKind;
}

export async function runListCoreMilestones(ctx: McpCtx, args: Record<string, unknown>) {
  await requireCoreCaller(ctx);
  const kind = asKind(args.kind);
  const term = await resolveTermId(typeof args.termCode === "string" ? args.termCode : undefined);
  const { items } = await getTermMilestones(term.id);
  const weeks = Array.from({ length: 11 }, (_, week) => ({
    week,
    items: items
      .filter((i) => i.week === week && (!kind || i.kind === kind))
      .map((i) => ({ id: i.id, kind: i.kind, title: i.title, notes: i.notes, owners: i.owners })),
  }));
  return { termId: term.id, termCode: term.code, weeks };
}

export async function runManageCoreMilestone(ctx: McpCtx, args: Record<string, unknown>) {
  await requireCoreCaller(ctx);
  const action = String(args.action);
  requireForAction(action, args, {
    create: ["termId", "week", "title"],
    update: ["id"],
    move: ["id", "toWeek"],
    delete: ["id"],
    fill_from_last_year: ["termId"],
  });
  const actor = { userId: ctx.user.id, request: ctx.request };
  try {
    switch (action) {
      case "create":
        return await createMilestone(
          {
            termId: String(args.termId),
            week: Number(args.week),
            kind: asKind(args.kind),
            title: String(args.title),
            notes: typeof args.notes === "string" ? args.notes : undefined,
            ownerIds: Array.isArray(args.ownerIds) ? args.ownerIds.map(String) : undefined,
          },
          actor,
        );
      case "update":
        return await updateMilestone(
          {
            id: String(args.id),
            title: typeof args.title === "string" ? args.title : undefined,
            notes: typeof args.notes === "string" ? args.notes : undefined,
            ownerIds: Array.isArray(args.ownerIds) ? args.ownerIds.map(String) : undefined,
            kind: asKind(args.kind),
          },
          actor,
        );
      case "move":
        await moveMilestone(
          {
            id: String(args.id),
            toWeek: Number(args.toWeek),
            toPosition: typeof args.toPosition === "number" ? args.toPosition : undefined,
          },
          actor,
        );
        return { ok: true };
      case "delete":
        await deleteMilestone(String(args.id), actor);
        return { ok: true };
      default:
        return await fillTermFromLastYear(String(args.termId), actor);
    }
  } catch (err) {
    if (err instanceof MilestoneError) {
      throw err.status === 404 ? new McpNotFoundError(err.message) : new McpInvalidError(err.message);
    }
    throw err;
  }
}

export const CORE_MILESTONE_TOOLS: McpTool[] = [
  { def: LIST_CORE_MILESTONES_TOOL, run: runListCoreMilestones },
  { def: MANAGE_CORE_MILESTONE_TOOL, run: runManageCoreMilestone },
];
