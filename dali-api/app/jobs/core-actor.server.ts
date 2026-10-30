import { prisma } from "~/lib/db.server";
import { resolveGroupMembers } from "~/lib/groups";

export type CoreActor = { actorId: string; coreGroupId: string } | { abort: string };

/** The first current Core member by id, for one-time jobs that create content as a person. */
export async function resolveCoreActor(): Promise<CoreActor> {
  const core = await prisma.groupDefinition.findUnique({
    where: { systemKey: "core" },
    select: { id: true },
  });
  if (!core) return { abort: "the Core group does not exist" };

  const actorId = [...(await resolveGroupMembers(core.id))].sort()[0];
  if (!actorId) return { abort: "there are no current Core members to create the roots as" };
  return { actorId, coreGroupId: core.id };
}
