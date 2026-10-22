import { prisma } from "~/lib/db";
import { toChannelSlug } from "~/chat/lib/chat-rules";

// No explicit project↔channel link exists; a project's channel is the one
// named like its Slack channel (or its name), so the two stay recognizable.
export async function projectChannelId(projectId: string, viewerId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, slackChannelName: true },
  });
  if (!project) return null;
  const names = [...new Set([project.slackChannelName, project.name].filter((n): n is string => Boolean(n)).map(toChannelSlug))];
  if (names.length === 0) return null;
  const channels = await prisma.chatConversation.findMany({
    where: {
      kind: "channel",
      name: { in: names },
      OR: [{ isPrivate: false }, { members: { some: { userId: viewerId } } }],
    },
    select: { id: true, name: true },
  });
  for (const n of names) {
    const hit = channels.find((c) => c.name === n);
    if (hit) return hit.id;
  }
  return null;
}
