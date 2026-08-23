// Core ▸ Agreements — the compliance console: signing status across every
// agreement, reminders to outstanding signers, and term-rollover activation.
// This is the permanent Core hub for agreements (the old `agreements-console`
// flag + Drive redirect are retired). Authoring, versioning, and config live in
// the Drive detail (/documents/agreement/:id); this route only aggregates status
// and fires reminder/activation actions. The create action is kept because
// Drive's "New agreement" posts here too.

import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/core.agreements";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, isCore } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import { logAuditEvent } from "~/lib/audit";
import { ensureCoreDriveRoot } from "~/lib/pages";
import type {
  SigningGateScope,
  SigningAudience,
  SigningCadence,
} from "~/generated/prisma/enums";
import { getAgreementsOverview } from "~/signing/lib/console.server";
import { activateVersion } from "~/signing/lib/activate.server";
import { notifySignRequest } from "~/signing/lib/notify.server";
import { SigningDocumentsPage } from "~/signing/components/SigningDocumentsPage";
import { AgreementsConsole } from "~/signing/components/AgreementsConsole";
import { SCOPES, AUDIENCES, CADENCES } from "~/signing/lib/document-config";

export const handle = coreHandle("agreements");

export const meta: Route.MetaFunction = () => [{ title: "Agreements · Core · DALI OS" }];

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "agreement"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 1;
  // Bounded loop — appends -2, -3, … until free.
  while (await prisma.signingDocument.findUnique({ where: { slug }, select: { id: true } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore) return redirect("/");

  // Path-keyed: only render the console on the Core URL. The documents/agreement
  // re-export also runs this loader and must fall through to the list data below.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/core/agreements")) {
    const overview = await getAgreementsOverview();
    return { mode: "console" as const, ...overview, isAdmin: roles.isAdmin };
  }

  const documents = await prisma.signingDocument.findMany({
    where: { archivedAt: null },
    include: {
      versions: { select: { id: true, versionNumber: true, publishedAt: true } },
      bindings: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return { mode: "list" as const, documents, isAdmin: roles.isAdmin };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) return { error: "Name is required" };
    const gateScope = formData.get("gateScope") as SigningGateScope;
    const audience = formData.get("audience") as SigningAudience;
    const cadence = formData.get("cadence") as SigningCadence;

    const doc = await prisma.signingDocument.create({
      data: {
        name,
        slug: await uniqueSlug(slugify(name)),
        gateScope: SCOPES.includes(gateScope) ? gateScope : "None",
        audience: AUDIENCES.includes(audience) ? audience : "Manual",
        cadence: CADENCES.includes(cadence) ? cadence : "Once",
      },
    });
    // File the new agreement into Core ▸ Agreements immediately (it's created
    // unplaced) so its Drive breadcrumb resolves without waiting for the next
    // Core-drive visit. Idempotent + best-effort — never block creation.
    await ensureCoreDriveRoot(auth.user.sub).catch(() => null);
    // Land on the Drive-namespaced route so the browser opens the agreement in
    // the Drive rather than the admin URL.
    return redirect(`/documents/agreement/${doc.id}`);
  }

  // Console: nudge a binding's outstanding signers. Reuses the same notify path
  // as activation (audience minus already-signed), throttled to ≤ once/24h.
  if (intent === "remind") {
    const bindingId = formData.get("bindingId") as string;
    const binding = await prisma.signingBinding.findUnique({
      where: { id: bindingId },
      select: {
        id: true,
        documentId: true,
        lastRemindedAt: true,
        document: { select: { archivedAt: true } },
      },
    });
    if (!binding || binding.document.archivedAt) return { error: "Binding not found." };
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (binding.lastRemindedAt && Date.now() - binding.lastRemindedAt.getTime() < DAY_MS) {
      return { error: "Already reminded in the last 24 hours." };
    }
    await notifySignRequest(bindingId);
    await prisma.signingBinding.update({
      where: { id: bindingId },
      data: { lastRemindedAt: new Date() },
    });
    await logAuditEvent({
      action: "signing.remind",
      userId: auth.user.sub,
      targetId: binding.documentId,
      metadata: { bindingId },
      request,
    });
    return { ok: true };
  }

  // Console: one-click term rollover — put the latest published version in force
  // for the current scope. Shares activateVersion with the Drive detail action.
  if (intent === "activate") {
    const documentId = formData.get("documentId") as string;
    const versionId = formData.get("versionId") as string;
    const result = await activateVersion({
      documentId,
      versionId,
      userId: auth.user.sub,
      request,
    });
    if ("error" in result) return { error: result.error };
    return { ok: true };
  }

  return null;
}

export default function AgreementsRoute() {
  const data = useLoaderData<typeof loader>();
  return data.mode === "console" ? <AgreementsConsole /> : <SigningDocumentsPage />;
}
