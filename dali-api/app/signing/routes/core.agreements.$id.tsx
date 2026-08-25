// Core ▸ Agreements → detail. Author immutable versions (place fields +
// variables, incl. pre-signed admin-signature fields), publish a version, and
// put a published version in force (bind) — which records the configured staff
// counter-signatures — and track signatories.

import { redirect } from "react-router";
import type { Route } from "./+types/core.agreements.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles, isCore, currentTerm } from "~/lib/roles";
import { nextTermCode } from "~/lib/terms.shared";
import { coreHandle } from "~/core/coreNav";
import { logAuditEvent } from "~/lib/audit";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { activateVersion } from "~/signing/lib/activate.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import { computeRoster, type BindingRoster } from "~/signing/lib/roster.server";
import { SCOPES, AUDIENCES, CADENCES } from "~/signing/lib/document-config";
import type {
  SigningGateScope,
  SigningAudience,
  SigningCadence,
} from "~/generated/prisma/enums";
import { SigningDocumentDetail } from "~/signing/components/SigningDocumentDetail";
import { parseSessionCookie } from "~/lib/cookies";
import { signingDraftName } from "~/collab/roomName";
import { readDocAsBlocks } from "~/collab/read";

export const handle = coreHandle("agreements");

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { document?: { name?: string } } | undefined)?.document?.name;
  return [{ title: `${name || "Agreement"} · Core · DALI OS` }];
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

  // /core/agreements/:id redirects to the Drive-namespaced route. Path-keyed:
  // this loader is also re-exported by documents.agreement.$id.tsx — only
  // redirect for core-path requests to avoid an infinite loop.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/core/agreements/")) {
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
  // term); non-enumerable audiences show the signed list only. computeRoster is
  // shared with the agreements console so the two stay in lockstep.
  const rosters: Record<string, BindingRoster> = {};
  const resolver = AUDIENCE_RESOLVERS[document.audience];
  for (const b of document.bindings) {
    const audience = resolver.enumerable
      ? await resolver.listMembers({ termId: b.termId ?? undefined })
      : null;
    rosters[b.id] = computeRoster(audience, b);
  }

  // Convert-on-read: pre-migration version bodies are legacy ProseMirror JSON;
  // the client (DocEditor) only ever sees block JSON. Never touches the DB row.
  const document_ = {
    ...document,
    versions: document.versions.map((v) => ({ ...v, body: ensureBlocks(v.body) })),
  };

  // Versions that already carry a member/admin signature are frozen even if
  // (defensively) still unpublished — the client uses this to gate Edit/Delete.
  const lockedVersionIds = [
    ...new Set(document.bindings.flatMap((b) => b.signatures.map((s) => s.versionId))),
  ];

  const me = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true },
  });

  // Sample values for the author's "Preview as signer" + the "+ Variable" menu
  // hints. {{term}}/{{upcomingTerm}} default to the current term but the author
  // picks the preview term client-side (an agreement is issued for a chosen
  // term — often an upcoming one — and {{term}} resolves to THAT term at sign
  // time, not the current one), so we also ship the current term code for the
  // picker to build its options from.
  const termNow = await currentTerm(request);
  const variablePreview: Record<string, string> = {
    term: termNow?.code ?? "",
    upcomingTerm: termNow?.code ? nextTermCode(termNow.code) : "",
    today: new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    memberName: "Jane Member",
    supervisorName: "DALI Staff",
  };

  const collabToken = parseSessionCookie(request);
  const collabRoomName = signingDraftName(params.id!);
  const collabUserName =
    [me?.firstName, me?.lastName].filter(Boolean).join(" ") || "Core";

  return {
    document: document_,
    isAdmin: roles.isAdmin,
    rosters,
    lockedVersionIds,
    variablePreview,
    currentTermCode: termNow?.code ?? "",
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

  if (intent === "save-version") {
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
    // Update-in-place when the newest version is still an editable draft
    // (unpublished + unsigned) so repeated saves don't stack junk versions;
    // otherwise append a fresh version. Publishing (or a signature) freezes a
    // version, and the next save then starts a new draft.
    const last = await prisma.signingDocumentVersion.findFirst({
      where: { documentId: params.id },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        publishedAt: true,
        _count: { select: { signatures: true } },
      },
    });
    if (last && !last.publishedAt && last._count.signatures === 0) {
      await prisma.signingDocumentVersion.update({
        where: { id: last.id },
        data: { body: body as object, roles, createdById: auth.user.sub },
      });
      await logAuditEvent({
        action: "signing.version.update",
        userId: auth.user.sub,
        targetId: params.id,
        metadata: { versionId: last.id },
        request,
      });
    } else {
      await prisma.signingDocumentVersion.create({
        data: {
          documentId: params.id!,
          versionNumber: (last?.versionNumber ?? 0) + 1,
          body: body as object,
          roles,
          createdById: auth.user.sub,
        },
      });
    }
    return redirect(back);
  }

  if (intent === "delete-version") {
    // Drafts (unpublished, unsigned, not in force) are disposable — deleting
    // them lets an author clear junk versions. Frozen versions are protected.
    const versionId = formData.get("versionId") as string;
    const version = await prisma.signingDocumentVersion.findUnique({
      where: { id: versionId },
      select: {
        documentId: true,
        publishedAt: true,
        _count: { select: { signatures: true, bindings: true } },
      },
    });
    if (!version || version.documentId !== params.id) return { error: "Version not found." };
    if (version.publishedAt || version._count.signatures > 0 || version._count.bindings > 0) {
      return { error: "This version is published or in use and can't be deleted." };
    }
    await prisma.signingDocumentVersion.delete({ where: { id: versionId } });
    await logAuditEvent({
      action: "signing.version.delete",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: { versionId },
      request,
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

  if (intent === "update") {
    // Edit the config facets — gate scope / audience / cadence. The create
    // form sets these once; this is the only post-create editor for them.
    // Validated against the shared allowlists; unknown/absent values are skipped.
    const gateScope = formData.get("gateScope") as SigningGateScope;
    const audience = formData.get("audience") as SigningAudience;
    const cadence = formData.get("cadence") as SigningCadence;
    const data: {
      gateScope?: SigningGateScope;
      audience?: SigningAudience;
      cadence?: SigningCadence;
      audienceGroupId?: string | null;
    } = {};
    if (SCOPES.includes(gateScope)) data.gateScope = gateScope;
    if (AUDIENCES.includes(audience)) data.audience = audience;
    if (CADENCES.includes(cadence)) data.cadence = cadence;
    // Group targeting: an explicit groupId pins a fixed group; its absence (the
    // one-click "Active this term" pill) means the binding's term group. Any
    // non-Group audience clears the stored group so it can't linger.
    if (data.audience === "Group") {
      const groupId = (formData.get("audienceGroupId") as string | null)?.trim();
      data.audienceGroupId = groupId ? groupId : null;
    } else if (data.audience !== undefined) {
      data.audienceGroupId = null;
    }
    if (Object.keys(data).length === 0) return { error: "No valid changes to save." };
    await prisma.signingDocument.update({ where: { id: params.id }, data });
    await logAuditEvent({
      action: "signing.configure",
      userId: auth.user.sub,
      targetId: params.id,
      metadata: data,
      request,
    });
    return redirect(back);
  }

  if (intent === "activate") {
    const versionId = formData.get("versionId") as string;
    const result = await activateVersion({
      documentId: params.id!,
      versionId,
      userId: auth.user.sub,
      request,
    });
    if ("error" in result) return { error: result.error };
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
