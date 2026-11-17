import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/alumni.invite.$token";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { getClientIp } from "~/lib/rate-limit";
import { clearSessionCookie } from "~/lib/cookies";
import { mintBetterAuthSession } from "~/lib/betterauth-session.server";
import { appendBetterAuthSessionCookie } from "~/lib/betterauth-cookie.server";
import { lookupAlumniInvite, redeemAlumniInvite, sendFreshAlumniInvite } from "~/lib/alumni-invite.server";
import { adoptInviteAddress } from "~/lib/contact-email.server";
import { AuthButton } from "~/components/auth/AuthButton";
import { AuthNotice, AuthShellV2 } from "~/components/auth/v2";

export const meta: Route.MetaFunction = () => [{ title: "DALI OS · Welcome back" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const invite = await lookupAlumniInvite(params.token);
  const auth = await requireAuth(request);
  if (auth.ok && invite.userId === auth.user.sub) {
    const row = await prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { alumniOnboardedAt: true },
    });
    return redirect(row?.alumniOnboardedAt ? "/" : "/alumni/onboarding");
  }
  return invite.status === "valid"
    ? { status: "valid" as const, firstName: invite.firstName ?? "" }
    : { status: "unavailable" as const };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();

  if (form.get("intent") === "new-link") {
    await sendFreshAlumniInvite(params.token);
    return { requested: true as const };
  }

  const redeemed = await redeemAlumniInvite(params.token);
  if (!redeemed.ok) return { expired: true as const };

  const headers = new Headers();
  const session = await mintBetterAuthSession({
    userId: redeemed.userId,
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("User-Agent") ?? undefined,
  });
  await appendBetterAuthSessionCookie(headers, session.token);
  clearSessionCookie(headers);

  await adoptInviteAddress(redeemed.userId, redeemed.sentTo, request);
  await logAuditEvent({
    action: "login.success",
    userId: redeemed.userId,
    metadata: { via: "alumni-invite", method: "alumni-invite" },
    request,
  });
  return redirect("/alumni/onboarding", { headers });
}

export default function AlumniInvite() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (data.status === "valid" && !(actionData && "expired" in actionData)) {
    return (
      <AuthShellV2 title={`Welcome back, ${data.firstName}.`}>
        <Form method="post" className="flex flex-col gap-4">
          <AuthButton type="submit" loading={submitting} loadingLabel="Signing you in…">
            Continue to DALI OS
          </AuthButton>
        </Form>
      </AuthShellV2>
    );
  }

  const requested = Boolean(actionData && "requested" in actionData);
  return (
    <AuthShellV2 title="This link has expired or was already used.">
      {requested ? (
        <AuthNotice
          tone="success"
          message="If this link came from DALI OS, a new one is on its way to the address it was sent to."
        />
      ) : (
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="new-link" />
          <AuthButton type="submit" loading={submitting} loadingLabel="Sending…">
            Email me a new link
          </AuthButton>
        </Form>
      )}
    </AuthShellV2>
  );
}
