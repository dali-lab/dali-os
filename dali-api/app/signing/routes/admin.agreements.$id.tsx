// Admin → Agreements → detail. Author immutable versions (place fields +
// variables, incl. pre-signed admin-signature fields), publish a version, and
// put a published version in force (bind) — which records the configured staff
// counter-signatures — and track signatories.

import { redirect } from "react-router";
import type { Route } from "./+types/admin.agreements.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, isCore } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import { logAuditEvent } from "~/lib/audit";
import { fullName } from "~/lib/display";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { resolveAdminScope } from "~/signing/lib/scope.server";
import { applyAdminSignatures } from "~/signing/lib/presign.server";
import { notifySignRequest } from "~/signing/lib/notify.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import { SigningDocumentDetail } from "~/signing/components/SigningDocumentDetail";
import { parseSessionCookie } from "~/lib/cookies";
import { signingDraftName } from "~/collab/roomName";
import { readDocAsBlocks } from "~/collab/read";

export const handle = coreHandle("agreements");

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { document?: { name?: string } } | undefined)?.document?.name;
  return [{ title: `${name || "Agreement"} · Admin · DALI OS` }];
};

function parseRoles(raw: string | null): string[] {
  const roles = (raw ?? "")
    .split(",")
    .map((r) => r.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""))
    .filter(Boolean);
  return roles.length > 0 ? [...new Set(roles)] : ["member"];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore) return redirect("/");

  // /admin/agreements/:id redirects to the Drive-namespaced route. Path-keyed:
  // this loader is also re-exported by documents.agreement.$id.tsx — only
  // redirect for admin-path requests to avoid an infinite loop.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/admin/agreements/")) {
    return redirect(`/documents/agreement/${params.id}`);
  }

  const document = await prisma.signingDocument.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      versions: {
        include: { createdBy: true },
        orderBy: { versionNumber: "desc" },
      },
      bindings: {
        include: {
          version: { select: { id: true, versionNumber: true } },
          term: { select: { code: true } },
          cycle: { select: { name: true } },
          signatures: {
            include: { signer: { select: { firstName: true, lastName: true } } },
            orderBy: { signedAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  // Signatory roster per binding: who has signed (linkable to their completed
  // copy) and — when the audience is enumerable — who hasn't. The audience
  // registry resolves the member set per binding (Mentors keys off the binding's
  // term); non-enumerable audiences show the signed list only.
  type Person = { id: string; firstName: string; lastName: string };
  const rosterFor = (
    audience: Person[] | null,
    b: (typeof document.bindings)[number],
  ) => {
    const memberSigs = b.signatures.filter(
      (s) => s.roleKey === "member" && s.versionId === b.versionId,
    );
    const signedIds = new Set(memberSigs.map((s) => s.signerUserId));
    const signed = memberSigs
      .map((s) => ({ name: s.typedName || fullName(s.signer) || "Unknown", signatureId: s.id }))
      .sort((a, z) => a.name.localeCompare(z.name));
    const outstanding = audience
      ? audience
          .filter((u) => !signedIds.has(u.id))
          .map((u) => `${u.firstName} ${u.lastName}`.trim())
          .sort()
      : null;
    return { signed, outstanding };
  };

  const rosters: Record<
    string,
    { signed: { name: string; signatureId: string }[]; outstanding: string[] | null }
  > = {};

  const resolver = AUDIENCE_RESOLVERS[document.audience];
  for (const b of document.bindings) {
    const audience = resolver.enumerable
      ? await resolver.listMembers({ termId: b.termId ?? undefined })
      : null;
    rosters[b.id] = rosterFor(audience, b);
  }

  // Convert-on-read: pre-migration version bodies are legacy ProseMirror JSON;
  // the client (DocEditor) only ever sees block JSON. Never touches the DB row.
  const document_ = {
    ...document,
    versions: document.versions.map((v) => ({ ...v, body: ensureBlocks(v.body) })),
  };

  const me = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true },
  });
  const collabToken = parseSessionCookie(request);
  const collabRoomName = signingDraftName(params.id!);
  const collabUserName =
    [me?.firstName, me?.lastName].filter(Boolean).join(" ") || "Core";

  return {
    document: document_,
    isAdmin: roles.isAdmin,
    rosters,
    collabToken,
    collabRoomName,
    collabUserName,
    currentUserId: auth.user.sub,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  // Post-action redirects go to the Drive URL — the canonical agreement surface.
  const back = `/documents/agreement/${params.id}`;

  if (intent === "create-version") {
    // Snapshot the working draft from the collab room. If the room has never
    // been written (brand-new document, no CollabDocument row yet), fall back
    // to a form-posted body for backward-compat with any in-flight request.
    const roomName = signingDraftName(params.id!);
    const roomBlocks = await readDocAsBlocks(roomName);
    let body: unknown;
    if (roomBlocks.length > 0) {
      body = roomBlocks;
    } else {
      // Fallback: room empty or not yet persisted — honour the form-posted body.
      const bodyRaw = formData.get("body") as string | null;
      try {
        body = bodyRaw ? JSON.parse(bodyRaw) : [];
      } catch {
        body = [];
      }
      body = ensureBlocks(body);
    }
    const roles = parseRoles(formData.get("roles") as string | null);
    const last = await prisma.signingDocumentVersion.findFirst({
      where: { documentId: params.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    await prisma.signingDocumentVersion.create({
      data: {
        documentId: params.id!,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        body: body as object,
        roles,
        createdById: auth.user.sub,
      },
    });
    return redirect(back);
  }

  if (intent === "publish") {
    const versionId = formData.get("versionId") as string;
    await prisma.signingDocumentVersion.update({
      where: { id: versionId },
      data: { publishedAt: new Date() },
    });
    await logAuditEvent({
      action: "signing.publish",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { versionId },
      request,
    });
    return redirect(back);
  }

  if (intent === "rename") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) return { error: "Name is required" };
    await prisma.signingDocument.update({ where: { id: params.id }, data: { name } });
    return redirect(back);
  }

  if (intent === "activate") {
    const versionId = formData.get("versionId") as string;
    const version = await prisma.signingDocumentVersion.findUnique({
      where: { id: versionId },
      select: { publishedAt: true, body: true },
    });
    if (!version?.publishedAt) return { error: "Publish the version before putting it in force." };

    const doc = await prisma.signingDocument.findUniqueOrThrow({
      where: { id: params.id },
      select: { cadence: true },
    });
    const scope = await resolveAdminScope(doc);
    if ("error" in scope) return { error: scope.error };

    // One binding per (document, scopeKey): re-activating swaps the version.
    const bound = await prisma.signingBinding.upsert({
      where: { documentId_scopeKey: { documentId: params.id!, scopeKey: scope.scopeKey } },
      create: {
        documentId: params.id!,
        versionId,
        scopeKey: scope.scopeKey,
        termId: scope.termId ?? null,
        cycleId: scope.cycleId ?? null,
      },
      update: { versionId },
      select: { id: true },
    });
    // Record the pre-signed staff counter-signatures configured in the body.
    await applyAdminSignatures({ bindingId: bound.id, versionId, body: version.body });
    await logAuditEvent({
      action: "signing.bind",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { versionId, scopeKey: scope.scopeKey },
      request,
    });
    await notifySignRequest(bound.id);
    return redirect(back);
  }

  if (intent === "archive") {
    await prisma.signingDocument.update({
      where: { id: params.id },
      data: { archivedAt: new Date() },
    });
    // Archiving removes the agreement — return to the Drive agreements view.
    return redirect("/drive?type=agreement");
  }

  return null;
}

export default SigningDocumentDetail;
