// Admin → Agreements → detail. Author immutable versions (place fields +
// variables), publish a version, put a published version in force (bind), have
// staff apply the fixed supervisor counter-signature, and track signatories.

import { redirect } from "react-router";
import type { Route } from "./+types/admin-console.agreements.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { fullName } from "~/lib/display";
import { resolveAdminScope } from "~/signing/lib/scope.server";
import { notifySignRequest } from "~/signing/lib/notify.server";
import { SigningDocumentDetail } from "~/signing/components/SigningDocumentDetail";

export const handle = { areaPills: true };

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

  return { document, isAdmin: roles.isAdmin };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const back = `/admin-console/agreements/${params.id}`;

  if (intent === "create-version") {
    const bodyRaw = formData.get("body") as string;
    let body: unknown;
    try {
      body = JSON.parse(bodyRaw);
    } catch {
      return { error: "Body must be valid JSON" };
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
      select: { publishedAt: true },
    });
    if (!version?.publishedAt) return { error: "Publish the version before putting it in force." };

    const doc = await prisma.signingDocument.findUniqueOrThrow({
      where: { id: params.id },
      select: { kind: true, audience: true, gateScope: true },
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

  if (intent === "archive") {
    await prisma.signingDocument.update({
      where: { id: params.id },
      data: { archivedAt: new Date() },
    });
    return redirect("/admin-console/agreements");
  }

  return null;
}

export default SigningDocumentDetail;
