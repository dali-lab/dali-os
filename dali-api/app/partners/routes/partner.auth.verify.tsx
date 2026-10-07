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
import { findOrLinkPartnerContact } from "~/partners/lib/partner-auth.server";
import { PARTNER_LINK_EXPIRY } from "~/partners/lib/magic-link";
import { useOsShellRoot } from "~/lib/os-shell";
import { buttonClasses } from "~/components/ui/Button";

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

  // Provision/link the PartnerContact for this user (idempotent). We need
  // the email to look up unlinked contacts by email (e.g. a Core-created
  // inquiry contact). personalEmail is the authoritative partner email field.
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { personalEmail: true },
  });
  if (userRow?.personalEmail) {
    const contact = await findOrLinkPartnerContact(userId, userRow.personalEmail);
    await prisma.partnerContact.update({
      where: { id: contact.id },
      data: { authProvider: "MagicLink" },
    });
  }
  // TODO(partner-crm): if personalEmail is null (edge case: user provisioned
  // without one), the contact will be created lazily by requirePartnerAccount.

  const headers = new Headers();
  setSessionCookie(headers, session.rawId);
  // The requirePartnerAccount guard JIT-provisions contacts, so onboarding
  // is optional — send authenticated partners straight to /partner.
  const returnTo = new URL(request.url).searchParams.get("returnTo");
  const dest = returnTo && returnTo.startsWith("/") ? returnTo : "/partner";
  return redirect(dest, { headers });
}

export default function PartnerAuthVerify({
  actionData,
}: Route.ComponentProps) {
  const { token, valid } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const error = actionData && "error" in actionData ? actionData.error : null;

  useOsShellRoot(true);

  return (
    <div className="os-shell flex min-h-screen items-center justify-center bg-os-bg px-6 text-foreground">
      <div className="w-full max-w-sm rounded-os-card bg-os-card p-8 text-center">
        <span className="font-os-logo text-2xl font-semibold text-os-accent">
          dali.os
        </span>
        {valid && !error ? (
          <>
            <h1 className="font-heading text-2xl font-bold text-foreground mt-6 mb-2">
              You're almost in
            </h1>
            <p className="text-os-grey mb-8">
              Continue to finish signing in to the DALI partner portal.
            </p>
            <Form method="post">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                disabled={submitting}
                className={buttonClasses("primary", "md", "w-full")}
              >
                {submitting ? "Signing in…" : "Continue to DALI OS"}
              </button>
            </Form>
          </>
        ) : (
          <>
            <h1 className="font-heading text-2xl font-bold text-foreground mt-6 mb-2">
              Link expired
            </h1>
            <p className="text-os-grey mb-8">
              {error ??
                `This sign-in link is invalid or has expired. Sign-in links work once and expire after ${PARTNER_LINK_EXPIRY}.`}
            </p>
            <a href="/partner/login" className={buttonClasses("primary", "md", "inline-block")}>
              Request a new link
            </a>
          </>
        )}
      </div>
    </div>
  );
}
