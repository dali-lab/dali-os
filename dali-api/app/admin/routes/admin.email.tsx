// Admin → Email: every operator-editable email in one place.
//
// Replaces three editors — the versioned-library detail page at
// /admin/email-templates/:id, the hiring cycle Setup-tab modal, and the
// education manage-page modal — and one role rule replaces three. Lab-wide copy
// is Core's: a per-cycle admin used to be able to rewrite the email every cycle
// shares.
//
// One route, not a list + detail pair: ?key= opens the editor over the list, so
// there is no id to resolve and no second loader.

import { redirect } from "react-router";
import type { Route } from "./+types/admin.email";

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { renderEmail } from "~/lib/email";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { renderAuthEmail } from "~/email/lib/layout.server";
import {
  EMAIL_TEMPLATE_KEYS,
  emailTemplateDef,
  isEmailTemplateKey,
  type EmailTemplateKey,
} from "~/email/lib/registry";
import {
  listEmailTemplates,
  listEmailTemplateVersions,
  rollbackEmailTemplate,
  saveEmailTemplate,
} from "~/email/lib/templates.server";
import {
  EmailTemplatesAdmin,
  type AdminEmailRow,
  type AdminEmailVersion,
} from "~/admin/components/EmailTemplatesAdmin";

export const meta: Route.MetaFunction = () => [{ title: "Email · Admin · DALI OS" }];

export const handle = {
  breadcrumbTrail: () => [{ label: "Email" }],
};

function fullName(u: { firstName: string | null; lastName: string | null } | null): string {
  if (!u) return "unknown";
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || "unknown";
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub, request))) return redirect("/");

  const url = new URL(request.url);
  const rawKey = url.searchParams.get("key");
  const openKey: EmailTemplateKey | null = isEmailTemplateKey(rawKey) ? rawKey : null;

  const stored = await listEmailTemplates();

  const editorIds = [
    ...new Set(
      [...stored.values()].map((t) => t.updatedById).filter((x): x is string => !!x),
    ),
  ];
  const editors = editorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: editorIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const editorById = new Map(editors.map((u) => [u.id, u]));

  const counts = await prisma.emailTemplateVersion.groupBy({
    by: ["templateKey"],
    _count: { _all: true },
  });
  const countByKey = new Map(counts.map((c) => [c.templateKey, c._count._all]));

  const rows: AdminEmailRow[] = EMAIL_TEMPLATE_KEYS.map((key) => {
    const row = stored.get(key);
    return {
      key,
      subject: row?.subject ?? null,
      body: row?.body ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedById ? fullName(editorById.get(row.updatedById) ?? null) : null,
      versionCount: countByKey.get(key) ?? 0,
    };
  });

  const versions: AdminEmailVersion[] = openKey
    ? (await listEmailTemplateVersions(openKey)).map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        subject: v.subject,
        body: v.body,
        createdAt: v.createdAt.toISOString(),
        author: fullName(v.createdBy),
      }))
    : [];

  return { rows, versions, openKey };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub, request))) return redirect("/");

  const formData = await request.formData();
  const intent = formData.get("intent");
  const rawKey = formData.get("key");
  if (!isEmailTemplateKey(rawKey)) return { error: "Unknown email." };
  const key = rawKey;

  if (intent === "save") {
    await saveEmailTemplate(
      key,
      {
        subject: (formData.get("subject") as string) ?? "",
        body: (formData.get("body") as string) ?? "",
      },
      auth.user.sub,
    );
    return redirect("/admin/email");
  }

  if (intent === "rollback") {
    const versionId = formData.get("versionId");
    if (typeof versionId !== "string") return { error: "No version selected." };
    await rollbackEmailTemplate(key, versionId, auth.user.sub);
    return redirect(`/admin/email?key=${encodeURIComponent(key)}`);
  }

  if (intent === "send-test") {
    const subject = ((formData.get("subject") as string) ?? "").trim();
    const body = ((formData.get("body") as string) ?? "").trim();
    if (!subject && !body) return { error: "Nothing to send yet." };

    const user = await prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { daliEmail: true },
    });
    if (!user?.daliEmail) {
      return { error: "Your account has no DALI email address on file." };
    }

    const def = emailTemplateDef(key);
    // Rendered through the same path a real send uses, so the test can't look
    // right while the send looks wrong.
    const rendered = renderEmail({ subject, body }, def.sample as never);
    const mail = await renderAuthEmail({
      subject: rendered.subject,
      bodyHtml: rendered.html,
      text: rendered.subject,
      preheader: `Test send of ${def.label}`,
    });

    // No dedupKey — a test send must go through every time it is clicked. The
    // sender identity is the one this email really uses, so the From: address in
    // the test matches production.
    const { id } = await enqueueOutbound({
      channel: "email",
      purpose: def.purpose,
      target: user.daliEmail,
      subject: `[TEST] ${mail.subject}`,
      bodyHtml: mail.html,
      bodyText: mail.text,
      eventType: "admin.test_email",
    });
    await drainNow([id]);
    return { testSent: true as const };
  }

  return null;
}

export default function AdminEmailRoute({ loaderData }: Route.ComponentProps) {
  return (
    <EmailTemplatesAdmin
      rows={loaderData.rows}
      versions={loaderData.versions}
      openKey={loaderData.openKey}
    />
  );
}
