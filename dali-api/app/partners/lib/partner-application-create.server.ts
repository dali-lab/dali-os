// Shared "create a partner application from Core" path — the server-side
// twin of both create entry points on the board (specs/partner-crm.md §4/§5):
// the route's form-based create intent (core.partners.tsx, the list view's
// inline form) and the JSON resource route the board modal's create mode
// calls (POST /api/partner-applications, api.partner-applications.ts). Both
// do the same validation and side effects — contact upsert by email, stage
// New at the top of the column, target terms, domains, a Created activity,
// and the partner.inquiry_received notification — so neither path drifts
// from the other.

import { prisma } from "~/lib/db";
import { logPartnerActivity } from "./partner-activity.server";
import { notifyPartners } from "./partner-notify.server";

const VALID_SOURCES = ["Email", "Form", "Referral", "Manual", "Renewal"] as const;
type ApplicationSource = (typeof VALID_SOURCES)[number];

function isValidSource(x: unknown): x is ApplicationSource {
  return typeof x === "string" && (VALID_SOURCES as readonly string[]).includes(x);
}

export type CreatePartnerApplicationInput = {
  title: string;
  applicantName?: string | null;
  applicantEmail: string;
  summary?: string | null;
  source?: string | null;
  targetTermIds?: string[];
  domainIds?: string[];
  actorUserId: string;
};

export type CreatePartnerApplicationResult = { id: string } | { error: string };

export async function createPartnerApplication(
  input: CreatePartnerApplicationInput,
): Promise<CreatePartnerApplicationResult> {
  const title = input.title.trim();
  const applicantName = (input.applicantName ?? "").trim();
  const applicantEmail = (input.applicantEmail ?? "").trim().toLowerCase();
  const summary = (input.summary ?? "").trim();
  const source = isValidSource(input.source) ? input.source : "Manual";
  const targetTermIds = [...new Set((input.targetTermIds ?? []).map((v) => v.trim()).filter(Boolean))];
  const domainIds = [...new Set((input.domainIds ?? []).map((v) => v.trim()).filter(Boolean))];

  if (!title) return { error: "A title is required." };
  if (!applicantEmail || !applicantEmail.includes("@")) {
    return { error: "A valid applicant email is required." };
  }

  // Find or create a PartnerContact keyed on the lowercased email.
  // Core-created records have no User account yet, so userId stays null.
  const contact = await prisma.partnerContact.upsert({
    where: { email: applicantEmail },
    create: {
      email: applicantEmail,
      name: applicantName || (applicantEmail.split("@")[0] ?? applicantEmail),
      userId: null,
    },
    update: {
      // If a name is supplied and the contact has no name yet, fill it in.
      ...(applicantName ? { name: applicantName } : {}),
    },
    select: { id: true },
  });

  // New cards land at the top of New (specs/partner-crm.md §4) — same
  // "one below the column's current minimum" placement setApplicationStage
  // uses on a stage move.
  const topOfNew = await prisma.partnerApplication.aggregate({
    where: { stage: "New" },
    _min: { position: true },
  });
  const position = (topOfNew._min.position ?? 1) - 1;

  const created = await prisma.partnerApplication.create({
    data: {
      title,
      applicantContactId: contact.id,
      partnerOrgId: null,
      stage: "New",
      position,
      source,
      summary: summary || null,
      ...(targetTermIds.length > 0
        ? { targetTerms: { create: targetTermIds.map((termId) => ({ termId })) } }
        : {}),
      ...(domainIds.length > 0
        ? { domains: { create: domainIds.map((domainId) => ({ domainId })) } }
        : {}),
    },
    select: { id: true },
  });

  await logPartnerActivity(prisma, {
    applicationId: created.id,
    actorUserId: input.actorUserId,
    type: "Created",
    metadata: { source },
  });

  await notifyPartners({
    eventType: "partner.inquiry_received",
    title: `New partner opportunity: ${title}`,
    body: applicantName ? `From ${applicantName} (${applicantEmail})` : applicantEmail,
    link: `/core/partners?application=${created.id}`,
  });

  return { id: created.id };
}
