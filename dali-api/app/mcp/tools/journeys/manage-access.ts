import { prisma } from "~/lib/db.server";
import { McpNotFoundError, requireForAction } from "../../errors";
import type { McpCtx, McpTool } from "../../registry";
import {
  addCollaborator,
  loadAccessEntries,
  removeCollaborator,
  setCollaboratorRole,
} from "~/journeys/lib/journeys.server";
import type { JourneyRole } from "~/journeys/lib/types";
import { journeyViewer, unwrap, inputSchema } from "./shared";

type Args = {
  action: "add" | "set_role" | "remove";
  journeyId: string;
  userId?: string;
  email?: string;
  role?: JourneyRole;
};

async function resolveUserId(args: Args): Promise<string> {
  if (args.userId) return args.userId;
  const email = args.email!.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ daliEmail: email }, { dartmouthEmail: email }, { personalEmail: email }] },
    select: { id: true },
  });
  if (!user) throw new McpNotFoundError(`No member with email ${args.email}.`);
  return user.id;
}

async function accessView(ctx: McpCtx, journeyId: string) {
  const viewer = await journeyViewer(ctx);
  const [entry] = await loadAccessEntries(viewer, { id: journeyId });
  if (!entry) throw new McpNotFoundError("Journey not found.");
  return {
    journeyId: entry.id,
    title: entry.title,
    yourRole: entry.role,
    people: entry.people.map((p) => ({ userId: p.id, name: p.name, email: p.email, role: p.role })),
  };
}

export const LIST_JOURNEY_ACCESS: McpTool = {
  def: {
    name: "list_journey_access",
    description:
      "List who can edit an onboarding journey and their role: owner (edits, publishes, deletes, manages access) or editor (edits and publishes). Also returns your own role.",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: { journeyId: { type: "string", minLength: 1 } },
      required: ["journeyId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:read",
  },
  run: async (ctx: McpCtx, raw) => accessView(ctx, (raw as { journeyId: string }).journeyId),
};

export const MANAGE_JOURNEY_ACCESS: McpTool = {
  def: {
    name: "manage_journey_access",
    description:
      "Change who can edit an onboarding journey. Roles: owner (edits, publishes, deletes, manages access) and editor (edits and publishes). Everyone else can take the journey once it's published. Actions: add (userId or email + role), set_role, remove. Only owners and Core can change access, and the last owner can't be demoted or removed. Returns the updated list; read it without changes with list_journey_access.",
    inputSchema: inputSchema({
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["add", "set_role", "remove"] },
        journeyId: { type: "string", minLength: 1 },
        userId: { type: "string" },
        email: { type: "string", description: "Instead of userId." },
        role: { type: "string", enum: ["owner", "editor"] },
      },
      required: ["action", "journeyId"],
      additionalProperties: false,
    }),
    requiredScope: "mcp:write",
  },
  run: async (ctx: McpCtx, raw) => {
    const args = raw as Args;
    const person = args.userId ? ["userId"] : ["email"];
    requireForAction(args.action, args, {
      add: [...person, "role"],
      set_role: [...person, "role"],
      remove: person,
    });
    const viewer = await journeyViewer(ctx);
    const userId = await resolveUserId(args);
    if (args.action === "add") unwrap(await addCollaborator(viewer, args.journeyId, userId, args.role!));
    else if (args.action === "set_role") unwrap(await setCollaboratorRole(viewer, args.journeyId, userId, args.role!));
    else unwrap(await removeCollaborator(viewer, args.journeyId, userId));
    return { ok: true, ...(await accessView(ctx, args.journeyId)) };
  },
};
