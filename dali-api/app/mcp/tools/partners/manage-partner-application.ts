// MCP tool: manage_partner_application — create and manage partner applications.
// Scope: mcp:write. Gated to isCore.
//
// Actions:
//   create              — create a new PartnerApplication (title + partnerOrgId required).
//   update_status       — change application status (applicationId + status required).
//   update_details      — update summary and/or replace target terms.
//   set_form            — bind a Form as the application form (formId required).
//   clear_form          — remove the application form binding.
//   add_domain          — add a domain to an application (applicationId + domainId required).
//   update_domain_scope — update expectedMembers on an application domain.
//   remove_domain       — remove a domain from an application.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  PARTNER_APPLICATION_STATUSES,
  isPartnerApplicationStatus,
} from "~/partners/lib/partner-application";
import {
  setApplicationFormBinding,
  clearApplicationFormBinding,
} from "~/partners/lib/application-form.server";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  requireForAction,
} from "../../registry";

export const MANAGE_PARTNER_APPLICATION_TOOL = {
  name: "manage_partner_application",
  description:
    "Create and manage partner applications. Actions: create (title required; identify applicant via applicantContactId OR applicantEmail+applicantName; partnerOrgId optional), update_status (applicationId+status required; valid statuses: Inquiry, Triaged, Meeting, ApplicationSubmitted, UnderReview, LearnMore, OnHold, Accepted, Rejected, Promoted), update_details (applicationId required; updates summary/terms), set_form (formId required; replaces the global application form binding), clear_form (removes the form binding), add_domain (applicationId+domainId required), update_domain_scope (applicationDomainId required; updates expectedMembers), remove_domain (applicationDomainId required). Requires Core access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "create",
          "update_status",
          "update_details",
          "set_form",
          "clear_form",
          "add_domain",
          "update_domain_scope",
          "remove_domain",
        ],
        description: "What to do.",
      },
      applicationId: {
        type: "string",
        description: "Required for most actions (not create, set_form, clear_form).",
      },
      title: { type: "string" },
      applicantContactId: {
        type: "string",
        description: "PartnerContact id. Preferred way to set the applicant on create.",
      },
      applicantEmail: {
        type: "string",
        description: "Applicant email — used with applicantName to find-or-create a PartnerContact when applicantContactId is not provided.",
      },
      applicantName: {
        type: "string",
        description: "Applicant display name (used when creating a new PartnerContact via applicantEmail).",
      },
      partnerOrgId: {
        type: "string",
        description: "PartnerOrg id. Optional on create (set only at promotion); required if you want to link an org immediately.",
      },
      status: {
        type: "string",
        enum: PARTNER_APPLICATION_STATUSES as unknown as string[],
        description: "Required for update_status.",
      },
      summary: { type: "string" },
      targetTermIds: {
        type: "array",
        items: { type: "string" },
        description: "Replace all target terms (update_details).",
      },
      formId: { type: "string", description: "Required for set_form." },
      domainId: { type: "string", description: "Required for add_domain." },
      applicationDomainId: {
        type: "string",
        description:
          "Required for update_domain_scope and remove_domain (PartnerApplicationDomain.id).",
      },
      expectedMembers: {
        type: "number",
        description: "Expected member count (update_domain_scope).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runManagePartnerApplication(
  callerId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can manage partner applications");
  }

  const action = input.action as string;

  requireForAction(action, input, {
    create: ["title"],
    update_status: ["applicationId", "status"],
    update_details: ["applicationId"],
    set_form: ["formId"],
    clear_form: [],
    add_domain: ["applicationId", "domainId"],
    update_domain_scope: ["applicationDomainId"],
    remove_domain: ["applicationDomainId"],
  });

  // ── create ────────────────────────────────────────────────────────────────
  if (action === "create") {
    // Resolve the applicant contact. Prefer an explicit contactId; fall back
    // to find-or-create by lowercased email; error if neither is provided.
    let applicantContactId: string;
    if (typeof input.applicantContactId === "string" && input.applicantContactId) {
      const existing = await prisma.partnerContact.findUnique({
        where: { id: input.applicantContactId },
        select: { id: true },
      });
      if (!existing) {
        throw new McpNotFoundError(`PartnerContact ${input.applicantContactId} not found`);
      }
      applicantContactId = existing.id;
    } else if (typeof input.applicantEmail === "string" && input.applicantEmail.includes("@")) {
      const email = input.applicantEmail.trim().toLowerCase();
      const name =
        typeof input.applicantName === "string" && input.applicantName.trim()
          ? input.applicantName.trim()
          : email.split("@")[0] ?? email;
      const contact = await prisma.partnerContact.upsert({
        where: { email },
        create: { email, name, userId: null },
        update: {},
        select: { id: true },
      });
      applicantContactId = contact.id;
    } else {
      throw new McpInvalidError(
        "Provide either applicantContactId or applicantEmail (and optionally applicantName) to identify the applicant",
      );
    }

    // Optionally link an existing PartnerOrg.
    let partnerOrgId: string | null = null;
    if (typeof input.partnerOrgId === "string" && input.partnerOrgId) {
      const org = await prisma.partnerOrg.findUnique({
        where: { id: input.partnerOrgId },
        select: { id: true },
      });
      if (!org) throw new McpNotFoundError(`Partner organization ${input.partnerOrgId} not found`);
      partnerOrgId = org.id;
    }

    const app = await prisma.partnerApplication.create({
      data: {
        title: (input.title as string).trim(),
        applicantContactId,
        partnerOrgId,
        status: "Inquiry",
        source: "Manual",
      },
      select: { id: true },
    });
    return { id: app.id };
  }

  // ── update_status ─────────────────────────────────────────────────────────
  if (action === "update_status") {
    const status = input.status as string;
    if (!isPartnerApplicationStatus(status)) {
      throw new McpInvalidError(
        `Invalid status '${status}'. Valid values: ${PARTNER_APPLICATION_STATUSES.join(", ")}`,
      );
    }
    try {
      await prisma.partnerApplication.update({
        where: { id: input.applicationId as string },
        data: { status },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2025") {
        throw new McpNotFoundError(`Partner application ${input.applicationId} not found`);
      }
      throw e;
    }
    return { ok: true };
  }

  // ── update_details ────────────────────────────────────────────────────────
  if (action === "update_details") {
    const applicationId = input.applicationId as string;
    const summaryRaw =
      typeof input.summary === "string" ? input.summary.trim() : undefined;
    const termIds = Array.isArray(input.targetTermIds)
      ? [...new Set((input.targetTermIds as string[]).map((v) => v.trim()).filter(Boolean))]
      : null;

    if (termIds !== null && termIds.length > 0) {
      const found = await prisma.term.findMany({
        where: { id: { in: termIds } },
        select: { id: true },
      });
      if (found.length !== termIds.length) {
        throw new McpInvalidError("One of those terms no longer exists");
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.partnerApplication.update({
          where: { id: applicationId },
          data:
            summaryRaw !== undefined
              ? { summary: summaryRaw === "" ? null : summaryRaw }
              : {},
        });
        if (termIds !== null) {
          await tx.partnerApplicationTargetTerm.deleteMany({
            where: { applicationId },
          });
          if (termIds.length > 0) {
            await tx.partnerApplicationTargetTerm.createMany({
              data: termIds.map((termId) => ({ applicationId, termId })),
            });
          }
        }
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2025") {
        throw new McpNotFoundError(`Partner application ${applicationId} not found`);
      }
      throw e;
    }
    return { ok: true };
  }

  // ── set_form ──────────────────────────────────────────────────────────────
  if (action === "set_form") {
    const result = await setApplicationFormBinding(input.formId as string, callerId);
    if (!result.ok) throw new McpInvalidError(result.error);
    return { ok: true };
  }

  // ── clear_form ────────────────────────────────────────────────────────────
  if (action === "clear_form") {
    await clearApplicationFormBinding();
    return { ok: true };
  }

  // ── add_domain ────────────────────────────────────────────────────────────
  if (action === "add_domain") {
    const applicationId = input.applicationId as string;
    const domainId = input.domainId as string;

    const [app, domain] = await Promise.all([
      prisma.partnerApplication.findUnique({
        where: { id: applicationId },
        select: { id: true },
      }),
      prisma.domain.findUnique({
        where: { id: domainId },
        select: { id: true },
      }),
    ]);
    if (!app) throw new McpNotFoundError(`Partner application ${applicationId} not found`);
    if (!domain) throw new McpNotFoundError(`Domain ${domainId} not found`);

    try {
      const row = await prisma.partnerApplicationDomain.create({
        data: { applicationId, domainId, expectedMembers: 0 },
        select: { id: true },
      });
      return { id: row.id };
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") {
        throw new McpInvalidError("That domain is already on this application");
      }
      throw e;
    }
  }

  // ── update_domain_scope ───────────────────────────────────────────────────
  if (action === "update_domain_scope") {
    const applicationDomainId = input.applicationDomainId as string;
    const existing = await prisma.partnerApplicationDomain.findUnique({
      where: { id: applicationDomainId },
      select: { id: true },
    });
    if (!existing) throw new McpNotFoundError(`Application domain ${applicationDomainId} not found`);

    const expectedMembers =
      typeof input.expectedMembers === "number"
        ? Math.max(0, Math.floor(input.expectedMembers))
        : undefined;

    await prisma.partnerApplicationDomain.update({
      where: { id: applicationDomainId },
      data: expectedMembers !== undefined ? { expectedMembers } : {},
    });
    return { ok: true };
  }

  // ── remove_domain ─────────────────────────────────────────────────────────
  const applicationDomainId = input.applicationDomainId as string;
  try {
    await prisma.partnerApplicationDomain.delete({
      where: { id: applicationDomainId },
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") {
      throw new McpNotFoundError(`Application domain ${applicationDomainId} not found`);
    }
    throw e;
  }
  return { ok: true };
}
