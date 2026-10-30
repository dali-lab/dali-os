// Helpers shared by the onboarding journey MCP tools. Every write goes through
// app/journeys/lib/journeys.server.ts, the same functions the editor uses, so
// permissions and the draft version check are identical.

import { prisma } from "~/lib/db.server";
import type { JsonSchema } from "~/lib/mcp-input";
import { McpError, McpForbiddenError, McpNotFoundError } from "../../errors";
import type { McpCtx } from "../../registry";
import { editDraft, resolveJourneyViewer, type JourneyResult, type JourneyViewer } from "~/journeys/lib/journeys.server";
import { validateJourney } from "~/journeys/lib/journey-validation";
import { editPath, journeyPath } from "~/journeys/lib/paths";
import type { JourneyContent, JourneyModule } from "~/journeys/lib/types";

export async function journeyViewer(ctx: McpCtx): Promise<JourneyViewer> {
  const viewer = await resolveJourneyViewer(ctx.user.id, ctx.request);
  if (!viewer) throw new McpForbiddenError("Onboarding journeys aren't turned on for you.");
  return viewer;
}

/** Turns a failed JourneyResult into the matching MCP error. */
export function unwrap<T extends object>(result: JourneyResult<T>): T {
  if (result.ok) return result;
  if (result.status === 404) throw new McpNotFoundError(result.error);
  if (result.status === 403) throw new McpForbiddenError(result.error);
  throw new McpError(result.error, result.status);
}

export async function journeyLinks(journeyId: string) {
  const row = await prisma.onboardingJourney.findUnique({
    where: { id: journeyId },
    select: { domain: { select: { code: true } } },
  });
  if (!row) return {};
  const slug = row.domain.code.toLowerCase();
  return { url: journeyPath(slug, journeyId), editUrl: editPath(slug, journeyId) };
}

export function findModule(draft: JourneyContent, moduleId: string): JourneyModule {
  const mod = draft.modules.find((m) => m.id === moduleId);
  if (!mod) throw new McpNotFoundError(`No module ${moduleId} in this journey.`);
  return mod;
}

export function replaceModule(draft: JourneyContent, mod: JourneyModule): JourneyContent {
  return { ...draft, modules: draft.modules.map((m) => (m.id === mod.id ? mod : m)) };
}

/** Moves the item at `from` to `to`, clamped to the list. */
export function moveTo<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

export function insertAt<T>(list: T[], item: T, index?: number): T[] {
  if (index === undefined || index >= list.length) return [...list, item];
  return [...list.slice(0, Math.max(0, index)), item, ...list.slice(Math.max(0, index))];
}

/** Saves a draft edit and reports what's left to fix before publishing. */
export async function saveEdit(
  viewer: JourneyViewer,
  journeyId: string,
  edit: (draft: JourneyContent) => JourneyContent | Promise<JourneyContent>,
  extra: Record<string, unknown> = {},
) {
  const { draft, version } = unwrap(await editDraft(viewer, journeyId, edit));
  return {
    ok: true,
    journeyId,
    version,
    ...extra,
    publishIssues: validateJourney(draft).map((i) => i.message),
    note: "Saved to the draft. Learners see it after manage_journey publish.",
    ...(await journeyLinks(journeyId)),
  };
}

/** An input schema with per-field descriptions for clients. JsonSchema doesn't
 *  declare `description`, but the validator ignores it and tools/list passes it on. */
export const inputSchema = (schema: Record<string, unknown>) => schema as JsonSchema;
