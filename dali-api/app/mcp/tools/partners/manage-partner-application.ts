import { prisma } from "~/lib/db.server";
import { deletePartnerApplication } from "~/partners/lib/partner-application-delete.server";
import { startProjectReturn } from "~/partners/lib/partner-returns.server";
import { isCore } from "~/lib/roles";
import {
  PARTNER_STAGES,
  isPartnerStage,
} from "~/partners/lib/partner-application";
import { setApplicationStage } from "~/partners/lib/partner-activity.server";
import {
  McpForbiddenError,
  McpNotFoundError,
  McpInvalidError,
  requireForAction,
} from "../../registry";

export const MANAGE_PARTNER_APPLICATION_TOOL = {
  name: "manage_partner_application",
  description:
    "Create and manage partner applications (Core only, no partner-facing emails). " +
    "Actions: create, update_stage (silent move, no email to the partner), update_title, update_details, " +
    "start_return (opens an application for a past project coming back; promoting it reopens that project), " +
    "delete (only for applications that were never promoted). " +
    "Evaluation is in evaluate_partner_application; form and domains are in set_partner_application_scope.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "create",
          "update_stage",
          "update_title",
          "update_details",
          "start_return",
          "delete",
        ],
        description: "What to do.",
      },
      applicationId: {
        type: "string",
        description: "Required for update_stage, update_title, update_details and delete.",
      },
      title: { type: "string", description: "Required for create and update_title." },
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
        description: "PartnerOrg id. Optional on create; required if you want to link an org immediately.",
      },
      projectId: {
        type: "string",
        description: "Required for start_return: the past Project.id coming back.",
      },
      continuesProjectId: {
        type: "string",
        description: "Optional on create: Project.id this application is a return of. Promotion then reopens that project.",
      },
      stage: {
        type: "string",
        enum: PARTNER_STAGES as unknown as string[],
        description: "Required for update_stage. Move is silent — no partner email sent.",
      },
      summary: { type: "string", description: "Application summary (update_details)." },
      targetTermIds: {
        type: "array",
        items: { type: "string" },
        description: "Replace all target terms (update_details), or the terms a return would run (start_return).",
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
    update_stage: ["applicationId", "stage"],
    update_title: ["applicationId", "title"],
    update_details: ["applicationId"],
    start_return: ["projectId", "targetTermIds"],
    delete: ["applicationId"],
  });

  // ── start_return ──────────────────────────────────────────────────────────
  if (action === "start_return") {
    const targetTermIds = Array.isArray(input.targetTermIds) ? input.targetTermIds.map(String) : [];
    const result = await startProjectReturn({
      projectId: input.projectId as string,
      targetTermIds,
      actorUserId: callerId,
    });
    if (result.ok) return { id: result.applicationId };
    if (result.error === "not-found") throw new McpNotFoundError(`Project ${input.projectId} not found`);
    throw new McpInvalidError(
      {
        "no-terms": "Pass at least one targetTermId.",
        "no-contact": "That project's partner has no active contact to carry over.",
        "already-open": "That project already has an open return application.",
      }[result.error],
    );
  }

  // ── delete ────────────────────────────────────────────────────────────────
  if (action === "delete") {
    const applicationId = input.applicationId as string;
    const result = await deletePartnerApplication(applicationId, callerId);
    if (!result.ok) {
      if (result.reason === "not-found") throw new McpNotFoundError(`Partner application ${applicationId} not found`);
      throw new McpInvalidError(result.message);
    }
    return { deleted: true, id: result.id, title: result.title };
  }

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

    let continuesProjectId: string | null = null;
    if (typeof input.continuesProjectId === "string" && input.continuesProjectId) {
      const project = await prisma.project.findUnique({
        where: { id: input.continuesProjectId },
        select: { id: true },
      });
      if (!project) throw new McpNotFoundError(`Project ${input.continuesProjectId} not found`);
      continuesProjectId = project.id;
    }

    const app = await prisma.partnerApplication.create({
      data: {
        title: (input.title as string).trim(),
        applicantContactId,
        partnerOrgId,
        continuesProjectId,
        stage: "New",
        source: continuesProjectId ? "Renewal" : "Manual",
      },
      select: { id: true },
    });
    return { id: app.id };
  }

  // ── update_title ──────────────────────────────────────────────────────────
  if (action === "update_title") {
    const applicationId = input.applicationId as string;
    const title = (input.title as string).trim();
    if (!title) throw new McpInvalidError("title cannot be empty");
    try {
      await prisma.partnerApplication.update({
        where: { id: applicationId },
        data: { title },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2025") {
        throw new McpNotFoundError(`Partner application ${applicationId} not found`);
      }
      throw e;
    }
    return { ok: true };
  }

  // ── update_stage ──────────────────────────────────────────────────────────
  if (action === "update_stage") {
    const stage = input.stage as string;
    if (!isPartnerStage(stage)) {
      throw new McpInvalidError(
        `Invalid stage '${stage}'. Valid values: ${PARTNER_STAGES.join(", ")}`,
      );
    }
    // Route through setApplicationStage so a StatusChanged PartnerActivity row
    // is written (mirrors api.partner-applications.$id.status.ts + the web
    // stage intent). A bare prisma.update leaves the application timeline with
    // no record of who changed the stage or when. Note: transactional CRM
    // side effects (partner-facing accept/reject/etc. emails) stay web-only.
    const prev = await setApplicationStage(prisma, {
      applicationId: input.applicationId as string,
      to: stage,
      actorUserId: callerId,
    });
    if (prev === null) {
      throw new McpNotFoundError(`Partner application ${input.applicationId} not found`);
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
            where: { applicationId, termId: { notIn: termIds } },
          });
          if (termIds.length > 0) {
            await tx.partnerApplicationTargetTerm.createMany({
              data: termIds.map((termId) => ({ applicationId, termId })),
              skipDuplicates: true,
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
  return { ok: true };
}
