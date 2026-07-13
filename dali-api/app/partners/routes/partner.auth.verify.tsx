import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.auth.verify";
import { prisma } from "~/lib/db";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/request-meta";
import { logAuditEvent } from "~/lib/audit";
import {
  consumePartnerMagicLink,
  peekPartnerMagicLink,
} from "~/partners/lib/magic-link.server";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Sign in" },
];

// GET never consumes the token — email security scanners (Outlook SafeLinks
// etc.) prefetch links and would burn a single-use token before the human
// clicks. The loader only checks validity; the POST below consumes.
export async function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const valid = token ? await peekPartnerMagicLink(token) : false;
  return { token, valid };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const token = String(formData.get("token") ?? "");
  const userId = token ? await consumePartnerMagicLink(token) : null;
  if (!userId) {
    return { error: "This link is invalid or has expired. Request a new one." };
  }

  const session = await issueSession({
    userId,
    userAgent: request.headers.get("user-agent") ?? undefined,
    ip: getClientIp(request),
  });
  await logAuditEvent({
    action: "login.success",
    userId,
    metadata: { provider: "magic-link", authType: "partner" },
    request,
  });

  const partnerUser = await prisma.partnerUser.findUnique({
    where: { userId },
    select: { id: true },
  });

  const headers = new Headers();
  setSessionCookie(headers, session.rawId);
  return redirect(partnerUser ? "/partner" : "/partner/onboarding", { headers });
}

export default function PartnerAuthVerify({
  actionData,
}: Route.ComponentProps) {
  const { token, valid } = useLoaderData<typeof loader>();
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
        {valid && !error ? (
          <>
            <h1 className="font-heading text-2xl font-bold text-dark-blue mb-2">
              You're almost in
            </h1>
            <p className="text-muted-foreground mb-8">
              Continue to finish signing in to the DALI partner portal.
            </p>
            <Form method="post">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
              >
                {submitting ? "Signing in…" : "Continue to DALI OS"}
              </button>
            </Form>
          </>
        ) : (
          <>
            <h1 className="font-heading text-2xl font-bold text-dark-blue mb-2">
              Link expired
            </h1>
            <p className="text-muted-foreground mb-8">
              {error ??
                "This sign-in link is invalid or has expired. Sign-in links work once and expire after 15 minutes."}
            </p>
            <a
              href="/partner/login"
              className="inline-block rounded-xl bg-dark-blue text-white font-heading font-semibold px-6 py-3 hover:opacity-90 transition"
            >
              Request a new link
            </a>
          </>
        )}
      </div>
    </div>
  );
}
