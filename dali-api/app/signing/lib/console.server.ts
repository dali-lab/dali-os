// Aggregation behind the Core ▸ Agreements console. Rolls the per-binding
// signatory data (buried one-agreement-at-a-time in the Drive detail page) up
// across every non-archived agreement: completion per binding, what needs a
// binding this term, and a recent-signatures feed. Read-only — authoring,
// versioning, and config all stay in the Drive detail. Gated by the
// `agreements-console` flag at the route.

import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { currentTerm } from "~/lib/roles";
import { computeRoster, makeAudienceRosterCache } from "./roster.server";

export interface ConsoleBinding {
  bindingId: string;
  versionNumber: number;
  scopeKey: string;
  scopeLabel: string; // term code ("26F"), cycle name, or "Lab-wide"
  termId: string | null;
  isCurrent: boolean; // app/cycle-scoped, or a term-scoped binding for the current term
  signedCount: number;
  total: number | null; // null => non-enumerable audience (count only, no %)
  outstanding: string[]; // [] when everyone signed or the audience isn't enumerable
  lastRemindedAt: Date | null;
}

export interface ConsoleAgreement {
  id: string;
  name: string;
  gateScope: string;
  audience: string;
  cadence: string;
  versionCount: number;
  publishedCount: number;
  draftPending: boolean; // newest version is an unpublished draft
  latestPublishedVersionId: string | null;
  needsActivation: boolean; // enforced + published, but no binding in force for the current scope
  // Names who'd be asked to sign if activated now (the current-scope audience).
  // Set only when needsActivation; null for a non-enumerable audience. Feeds the
  // "send to who" confirm before putting a version in force.
  pendingRecipients: string[] | null;
  bindings: ConsoleBinding[];
}

export interface ConsoleActivity {
  signatureId: string;
  documentId: string;
  documentName: string;
  signerName: string;
  signedAt: Date;
}

export interface AgreementsOverview {
  agreements: ConsoleAgreement[];
  activity: ConsoleActivity[];
  currentTermCode: string | null;
}

export async function getAgreementsOverview(): Promise<AgreementsOverview> {
  const [docs, term] = await Promise.all([
    prisma.signingDocument.findMany({
      where: { archivedAt: null },
      include: {
        versions: {
          select: { id: true, versionNumber: true, publishedAt: true },
          orderBy: { versionNumber: "desc" },
        },
        bindings: {
          include: {
            version: { select: { versionNumber: true } },
            term: { select: { code: true } },
            cycle: { select: { name: true } },
            signatures: {
              select: {
                id: true,
                roleKey: true,
                versionId: true,
                signerUserId: true,
                typedName: true,
                signer: { select: { firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    currentTerm(),
  ]);

  const currentTermId = term?.id ?? null;
  const rosterFor = makeAudienceRosterCache();

  const agreements: ConsoleAgreement[] = [];
  for (const doc of docs) {
    const bindings: ConsoleBinding[] = [];
    let hasCurrentBinding = false;

    for (const b of doc.bindings) {
      const audience = await rosterFor(doc.audience, b.termId ?? undefined, doc.audienceGroupId);
      const roster = computeRoster(audience, b);
      // App- and cycle-scoped bindings (termId null) are always "current"; a
      // term-scoped binding is current only for the active term. Prior-term
      // bindings linger in place, so the console defaults to hiding them.
      const isCurrent = b.termId == null || b.termId === currentTermId;
      if (isCurrent) hasCurrentBinding = true;
      bindings.push({
        bindingId: b.id,
        versionNumber: b.version.versionNumber,
        scopeKey: b.scopeKey,
        scopeLabel: b.cycle?.name ?? b.term?.code ?? "Lab-wide",
        termId: b.termId ?? null,
        isCurrent,
        signedCount: roster.signed.length,
        total:
          roster.outstanding === null ? null : roster.signed.length + roster.outstanding.length,
        outstanding: roster.outstanding ?? [],
        lastRemindedAt: b.lastRemindedAt ?? null,
      });
    }

    const newest = doc.versions[0] ?? null;
    const published = doc.versions.filter((v) => v.publishedAt);
    // "Needs activation": an app-gated agreement with a publishable version but
    // no binding in force for the current scope. PerCycle agreements are bound
    // from the hiring cycle UI, never here, so they're excluded.
    const needsActivation =
      doc.gateScope === "App" &&
      doc.cadence !== "PerCycle" &&
      published.length > 0 &&
      !hasCurrentBinding;

    // Who activation would ask to sign right now: the audience for the scope an
    // activate targets (current term for PerTerm, lab-wide otherwise). No binding
    // exists yet, so nobody has signed — the whole audience is pending.
    let pendingRecipients: string[] | null = null;
    if (needsActivation) {
      const scopeTermId = doc.cadence === "PerTerm" ? (currentTermId ?? undefined) : undefined;
      const audience = await rosterFor(doc.audience, scopeTermId, doc.audienceGroupId);
      pendingRecipients = audience
        ? audience.map((p) => `${p.firstName} ${p.lastName}`.trim()).sort()
        : null;
    }

    agreements.push({
      id: doc.id,
      name: doc.name,
      gateScope: doc.gateScope,
      audience: doc.audience,
      cadence: doc.cadence,
      versionCount: doc.versions.length,
      publishedCount: published.length,
      draftPending: !!newest && !newest.publishedAt,
      latestPublishedVersionId: published[0]?.id ?? null,
      needsActivation,
      pendingRecipients,
      bindings,
    });
  }

  // Recent member signatures across the member-facing agreements (hiring
  // confidentiality — gateScope HiringCycle — is hiring-internal, excluded like
  // the personal archive does).
  const recent = await prisma.signingSignature.findMany({
    where: {
      roleKey: "member",
      binding: { document: { archivedAt: null, gateScope: { not: "HiringCycle" } } },
    },
    select: {
      id: true,
      signedAt: true,
      typedName: true,
      signer: { select: { firstName: true, lastName: true } },
      binding: { select: { documentId: true, document: { select: { name: true } } } },
    },
    orderBy: { signedAt: "desc" },
    take: 15,
  });
  const activity: ConsoleActivity[] = recent.map((s) => ({
    signatureId: s.id,
    documentId: s.binding.documentId,
    documentName: s.binding.document.name,
    signerName: s.typedName || fullName(s.signer ?? {}) || "Someone",
    signedAt: s.signedAt,
  }));

  return { agreements, activity, currentTermCode: term?.code ?? null };
}
