// Term-agreement issuance: preview + dispatch for putting this term's recurring
// agreements in force and sending their sign requests. Shared by the staffing
// board's "Issue term agreements" action (used once a term is staffed) and any
// other caller that wants the "which agreement → who" preview before it fires.
// Both confirm the recipient list first — issuance is never silent.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { AUDIENCE_RESOLVERS } from "./audiences";
import { activateVersion } from "./activate.server";

export interface IssuablePreview {
  documentId: string;
  documentName: string;
  recipientCount: number; // audience minus whoever already signed the latest version
  recipientNames: string[];
  alreadyInForce: boolean; // a current-term binding already exists (a re-issue)
}

export interface TermIssuePreview {
  termCode: string | null;
  items: IssuablePreview[];
}

// The recurring (PerTerm) App-gated agreements that can be issued for a term —
// the staffing board's selected term (opts.termId), which may be a not-yet-
// started term whose agreements go out early; defaults to the current term.
// Each item carries the roster a fresh sign request would reach: the term
// audience minus whoever already signed the latest published version. Empty
// items (e.g. a term-group agreement before staffing populates the term group)
// still surface, so the confirm can show "0 people".
export async function previewTermIssue(
  opts: { termId?: string } = {},
): Promise<TermIssuePreview> {
  const term = opts.termId
    ? await prisma.term.findUnique({
        where: { id: opts.termId },
        select: { id: true, code: true },
      })
    : await currentTerm();
  if (!term) return { termCode: null, items: [] };
  const scopeKey = `term:${term.id}`;

  const docs = await prisma.signingDocument.findMany({
    where: {
      archivedAt: null,
      gateScope: "App",
      cadence: "PerTerm",
      versions: { some: { publishedAt: { not: null } } },
    },
    select: {
      id: true,
      name: true,
      audience: true,
      audienceGroupId: true,
      versions: {
        where: { publishedAt: { not: null } },
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true },
      },
      bindings: {
        where: { scopeKey },
        select: {
          signatures: {
            where: { roleKey: "member" },
            select: { signerUserId: true, versionId: true },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const items: IssuablePreview[] = [];
  for (const doc of docs) {
    const versionId = doc.versions[0]?.id;
    if (!versionId) continue;
    const audience = await AUDIENCE_RESOLVERS[doc.audience].listMembers({
      termId: term.id,
      audienceGroupId: doc.audienceGroupId,
    });
    const existing = doc.bindings[0];
    // Whoever already signed the version this issue would put in force is not
    // re-notified (activate → notifySignRequest applies the same filter).
    const signed = new Set(
      existing?.signatures.filter((s) => s.versionId === versionId).map((s) => s.signerUserId) ?? [],
    );
    const recipients = audience.filter((p) => !signed.has(p.id));
    items.push({
      documentId: doc.id,
      documentName: doc.name,
      recipientCount: recipients.length,
      recipientNames: recipients.map((p) => `${p.firstName} ${p.lastName}`.trim()).sort(),
      alreadyInForce: !!existing,
    });
  }
  return { termCode: term.code, items };
}

// Put each document's latest published version in force for the target term
// (opts.termId — the staffing board's selected term; defaults to the current
// term). activateVersion handles the binding upsert, admin counter-signatures,
// audit, and the sign-request notification — so this is idempotent and
// re-issuing only notifies members who still owe a signature.
export async function issueTermAgreements(opts: {
  documentIds: string[];
  userId: string;
  termId?: string;
  request?: Request;
}): Promise<{ issued: number; errors: string[] }> {
  let issued = 0;
  const errors: string[] = [];
  for (const documentId of opts.documentIds) {
    const latest = await prisma.signingDocumentVersion.findFirst({
      where: { documentId, publishedAt: { not: null } },
      orderBy: { versionNumber: "desc" },
      select: { id: true },
    });
    if (!latest) continue;
    const res = await activateVersion({
      documentId,
      versionId: latest.id,
      userId: opts.userId,
      termId: opts.termId,
      request: opts.request,
    });
    if ("ok" in res) issued++;
    else errors.push(res.error);
  }
  return { issued, errors };
}
