// Admin → Agreements → detail. Author immutable versions (place fields +
// variables), publish a version, put a published version in force (bind), have
// staff apply the fixed supervisor counter-signature, and track signatories.

import { redirect } from "react-router";
import type { Route } from "./+types/admin.agreements.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles, isCore } from "~/lib/roles";
import { adminHandle } from "~/admin/adminNav";
import { logAuditEvent } from "~/lib/audit";
import { fullName } from "~/lib/display";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { resolveAdminScope } from "~/signing/lib/scope.server";
import { notifySignRequest } from "~/signing/lib/notify.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import { SigningDocumentDetail } from "~/signing/components/SigningDocumentDetail";

export const handle = adminHandle("agreements");

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
  if (!auth.ok) return redirect("/login");
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore) return redirect("/");

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

  return { document: document_, isAdmin: roles.isAdmin, rosters };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const back = `/admin/agreements/${params.id}`;

  if (intent === "create-version") {
    const bodyRaw = formData.get("body") as string;
    let body: unknown;
    try {
      body = JSON.parse(bodyRaw);
    } catch {
      return { error: "Body must be valid JSON" };
    }
    // New/edited versions store BLOCK JSON: block arrays pass through, a stale
    // client posting legacy ProseMirror gets converted, junk becomes empty.
    body = ensureBlocks(body);
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
      select: { publishedAt: true },
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

  if (intent === "countersign") {
    const bindingId = formData.get("bindingId") as string;
    const binding = await prisma.signingBinding.findUnique({
      where: { id: bindingId },
      select: { versionId: true },
    });
    if (!binding) return { error: "Binding not found" };

    const me = await prisma.user.findUniqueOrThrow({
      where: { id: auth.user.sub },
      select: { firstName: true, lastName: true },
    });
    const url = new URL(request.url);
    await prisma.signingSignature.upsert({
      where: {
        bindingId_signerUserId_roleKey: {
          bindingId,
          signerUserId: auth.user.sub,
          roleKey: "supervisor",
        },
      },
      create: {
        bindingId,
        versionId: binding.versionId,
        signerUserId: auth.user.sub,
        roleKey: "supervisor",
        typedName: fullName(me),
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        userAgent: request.headers.get("user-agent") || null,
        fieldValues: {},
      },
      update: { versionId: binding.versionId, signedAt: new Date(), typedName: fullName(me) },
    });
    void url;
    await logAuditEvent({
      action: "signing.staff_countersign",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { bindingId },
      request,
    });
    return redirect(back);
  }

  if (intent === "countersign-all") {
    // Apply the fixed staff signature to every in-force binding that doesn't
    // have one yet, in one click.
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: auth.user.sub },
      select: { firstName: true, lastName: true },
    });
    const bindings = await prisma.signingBinding.findMany({
      where: { documentId: params.id },
      select: {
        id: true,
        versionId: true,
        signatures: { where: { roleKey: "supervisor" }, select: { id: true } },
      },
    });
    const ip =
      request.headers.get("fly-client-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null;
    const userAgent = request.headers.get("user-agent") || null;
    for (const b of bindings) {
      if (b.signatures.length > 0) continue;
      await prisma.signingSignature.create({
        data: {
          bindingId: b.id,
          versionId: b.versionId,
          signerUserId: auth.user.sub,
          roleKey: "supervisor",
          typedName: fullName(me),
          ip,
          userAgent,
          fieldValues: {},
        },
      });
    }
    await logAuditEvent({
      action: "signing.staff_countersign",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { bulk: true },
      request,
    });
    return redirect(back);
  }

  if (intent === "archive") {
    await prisma.signingDocument.update({
      where: { id: params.id },
      data: { archivedAt: new Date() },
    });
    return redirect("/admin/agreements");
  }

  return null;
}

export default SigningDocumentDetail;
