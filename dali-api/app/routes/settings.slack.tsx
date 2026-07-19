import { redirect } from "react-router";
import { requireAuth, unauthorized, forbidden, isPartnerAccount } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { lookupSlackUserByEmail } from "~/slack/lib/slack-client";
import { logAuditEvent } from "~/lib/audit";
import type { Route } from "./+types/settings.slack";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function loader() {
  return redirect("/settings#slack");
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (auth.user.type === "applicant") return forbidden(request);
  if (await isPartnerAccount(auth)) return forbidden(request);

  const userId = auth.user.sub;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "disconnect") {
    await prisma.user.update({ where: { id: userId }, data: { slackUserId: null } });
    await logAuditEvent({
      action: "slack.disconnect",
      userId,
      targetId: userId,
      metadata: {},
      request,
    });
    return { ok: true, slackUserId: null, error: null };
  }

  if (intent === "connect") {
    if (!process.env.SLACK_BOT_TOKEN) {
      return { ok: false, slackUserId: null, error: "Slack isn't configured on the server." };
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { daliEmail: true, dartmouthEmail: true, personalEmail: true },
    });
    const emails = [user?.daliEmail, user?.dartmouthEmail, user?.personalEmail].filter(
      (e): e is string => !!e,
    );

    let slackId: string | null = null;
    for (const email of emails) {
      slackId = await lookupSlackUserByEmail(email);
      if (slackId) break;
    }
    if (!slackId) {
      return {
        ok: false,
        slackUserId: null,
        error:
          "No Slack account found for your emails on file. Make sure your DALI Slack uses one of them, then try again.",
      };
    }

    try {
      await prisma.user.update({ where: { id: userId }, data: { slackUserId: slackId } });
    } catch {
      return {
        ok: false,
        slackUserId: null,
        error: "That Slack account is already linked to another DALI OS user.",
      };
    }
    await logAuditEvent({
      action: "slack.connect",
      userId,
      targetId: userId,
      metadata: { slackUserId: slackId },
      request,
    });
    return { ok: true, slackUserId: slackId, error: null };
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

export default function SettingsSlackRedirect() {
  return null;
}
