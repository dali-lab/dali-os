import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.invite.$token";
import { prisma } from "~/lib/db";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/request-meta";
import { logAuditEvent } from "~/lib/audit";
import {
  acceptPartnerInvite,
  peekPartnerInvite,
} from "~/partners/lib/invites.server";
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Partner invitation" },
];

// Same GET-landing / POST-consume shape as the magic-link verify route —
// scanners must not be able to burn the invite.
export async function loader({ params }: Route.LoaderArgs) {
  const invite = await peekPartnerInvite(params.token!);
  return { invite };
}

export async function action({ request, params }: Route.ActionArgs) {
  const result = await acceptPartnerInvite(params.token!, request);
  if ("error" in result) return result;

  // Accepting signs the invitee in as the invite's user, replacing any
  // existing session cookie — the invite token itself is the credential.
  const session = await issueSession({
    userId: result.userId,
    userAgent: request.headers.get("user-agent") ?? undefined,
    ip: getClientIp(request),
  });
  await logAuditEvent({
    action: "login.success",
    userId: result.userId,
    metadata: { provider: "invite", authType: "partner" },
    request,
  });

  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { firstName: true },
  });

  const headers = new Headers();
  setSessionCookie(headers, session.rawId);
  // Fresh accounts still need a name; onboarding renders its
  // profile-completion variant when a PartnerUser row already exists.
  return redirect(user?.firstName ? "/partner" : "/partner/onboarding", {
    headers,
  });
}

export default function PartnerInvite({ actionData }: Route.ComponentProps) {
  const { invite } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <img
          src="/logo-blue.svg"
          alt="DALI Lab"
          className="h-12 w-auto mx-auto mb-8"
        />
        {invite && !error ? (
          <>
            <h1 className="font-heading text-2xl font-bold text-dark-blue mb-2">
              Join {invite.orgName}
            </h1>
            <p className="text-muted-foreground mb-8">
              You've been invited to join <strong>{invite.orgName}</strong> on
              the DALI Lab partner portal as {invite.email}.
            </p>
            <Form method="post">
              <button
                type="submit"
                disabled={submitting}
                className={buttonClasses("primary", "md", "w-full py-3")}
              >
                {submitting ? "Joining…" : "Accept invitation"}
              </button>
            </Form>
          </>
        ) : (
          <>
            <h1 className="font-heading text-2xl font-bold text-dark-blue mb-2">
              Invitation unavailable
            </h1>
            <p className="text-muted-foreground mb-8">
              {error ??
                "This invitation is invalid, expired, or was revoked. Ask your organization to send a new one."}
            </p>
            <a
              href="/partner/login"
              className={buttonClasses("primary")}
            >
              Go to partner sign in
            </a>
          </>
        )}
      </div>
    </div>
  );
}
