import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/alumni.lab";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { readOnlyRoles } from "~/lib/read-only-roles.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadQuestState } from "~/lib/alumni-game.server";
import { isAvatarConfig } from "~/components/alumni-game/pixel-avatar";
import { LabSceneView } from "~/components/alumni-game/LabSceneView";

export const meta: Route.MetaFunction = () => [{ title: "The Lab · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const userId = auth.user.sub;
  const roles = await readOnlyRoles(userId, request);
  if (!roles.isLabMemberOrAlum) return redirect("/");
  if (!(await isFeatureEnabled("alumni-game", userId, roles, request))) return redirect("/");

  const row = await prisma.pixelAvatar.findUnique({
    where: { userId },
    select: {
      skinTone: true,
      eyeColor: true,
      hairColor: true,
      hairstyle: true,
      questAcceptedAt: true,
    },
  });
  if (!row) return redirect("/alumni/welcome");
  const avatar = {
    skinTone: row.skinTone,
    eyeColor: row.eyeColor,
    hairColor: row.hairColor,
    hairstyle: row.hairstyle,
  };
  if (!isAvatarConfig(avatar)) return redirect("/alumni/welcome");

  const [{ profile, ctx }, chatLog] = await Promise.all([
    loadQuestState(userId),
    prisma.alumniChatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { from: true, text: true },
    }),
  ]);
  return {
    avatar,
    playerName: auth.user.firstName ?? "",
    profile,
    questCtx: ctx,
    questAccepted: row.questAcceptedAt !== null,
    chatLog: chatLog.map((m) => ({ from: m.from as "tim" | "you", text: m.text })),
  };
}

export default function AlumniLab() {
  const { avatar, playerName, profile, questCtx, questAccepted, chatLog } =
    useLoaderData<typeof loader>();
  return (
    <LabSceneView
      avatar={avatar}
      playerName={playerName}
      profile={profile}
      questCtx={questCtx}
      questAccepted={questAccepted}
      chatLog={chatLog}
    />
  );
}
