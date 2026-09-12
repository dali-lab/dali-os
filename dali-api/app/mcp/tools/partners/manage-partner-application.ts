// MCP tool: manage_partner_application — create and manage partner applications.
// Scope: mcp:write. Gated to isCore.
//
// Actions:
//   create              — create a new PartnerApplication (title + partnerOrgId required).
//   update_status       — change application status (applicationId + status required).
//   update_title        — rename the application (applicationId + title required).
//   update_details      — update summary and/or replace target terms.
//   assign_meeter       — set the Core member responsible for the discovery meeting.
//   save_eval           — save the 8-criterion rubric + interviewRating + notes.
//   save_acceptance     — save ambiguityRating and/or fundingModel post-accept.
//   add_note            — add a free-text Note to the activity timeline.
//   set_form            — bind a Form as the application form (formId required).
//   clear_form          — remove the application form binding.
//   add_domain          — add a domain to an application (applicationId + domainId required).
//   update_domain_scope — update expectedMembers (and optionally expectedChallenges as plain text) on an application domain.
//   remove_domain       — remove a domain from an application.
//
// NOTE: actions that trigger partner-facing emails (offer-meeting, send-application,
// reject, learn-more, accept) are intentionally not exposed. Use update_status to
// move the status silently (logs the change; no email sent).

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
  setApplicationStatus,
  logPartnerActivity,
} from "~/partners/lib/partner-activity.server";
import {
  EVAL_CRITERIA,
  EVAL_CRITERIA_VERSION,
  type EvalCriterionKey,
} from "~/partners/lib/discovery-rubric";
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
    "Actions: create (title required; applicantContactId OR applicantEmail+applicantName; partnerOrgId optional), " +
    "update_status (applicationId+status; silent move — no email sent to partner), " +
    "update_title (applicationId+title required), " +
    "update_details (applicationId; updates summary/targetTermIds), " +
    "assign_meeter (applicationId+assignedMeeterId; pass empty string to clear), " +
    "save_eval (applicationId; evalScores object with any of the 8 criterion keys feasibility/impact/originality/learning/devChallenges/designChallenges/partnerTeam/funding as 1-5 integers; optional interviewRating 1-5; optional evalNotes string), " +
    "save_acceptance (applicationId; ambiguityRating 1-5 and/or fundingModel string), " +
    "add_note (applicationId+body; writes a Note-type activity to the timeline), " +
    "set_form (formId), clear_form, " +
    "add_domain (applicationId+domainId), " +
    "update_domain_scope (applicationDomainId; expectedMembers and/or expectedChallenges as plain text — NOTE: expectedChallenges is a collab block doc on the web; MCP writes a plain-text paragraph block), " +
    "remove_domain (applicationDomainId).",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "create",
          "update_status",
          "update_title",
          "update_details",
          "assign_meeter",
          "save_eval",
          "save_acceptance",
          "add_note",
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
      status: {
        type: "string",
        enum: PARTNER_APPLICATION_STATUSES as unknown as string[],
        description: "Required for update_status. Move is silent — no partner email sent.",
      },
      summary: { type: "string" },
      targetTermIds: {
        type: "array",
        items: { type: "string" },
        description: "Replace all target terms (update_details).",
      },
      assignedMeeterId: {
        type: "string",
        description: "User id of the Core meeter to assign (assign_meeter). Empty string clears the assignment.",
      },
      evalScores: {
        type: "object",
        description:
          "Criterion scores for save_eval. Object with any subset of keys: feasibility, impact, originality, learning, devChallenges, designChallenges, partnerTeam, funding — each an integer 1–5.",
        additionalProperties: true,
      },
      interviewRating: {
        type: "number",
        description: "Overall interview rating 1–5 (save_eval).",
      },
      evalNotes: {
        type: "string",
        description: "Free-text eval notes (save_eval).",
      },
      ambiguityRating: {
        type: "number",
        description: "Ambiguity rating 1–5 (save_acceptance).",
      },
      fundingModel: {
        type: "string",
        description: "Funding model description (save_acceptance).",
      },
      body: {
        type: "string",
        description: "Note text (add_note). Cannot be empty.",
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
      expectedChallenges: {
        type: "string",
        description:
          "Plain-text description of expected challenges for this domain (update_domain_scope). " +
          "COLLAB-BODY FLAG: the web UI stores this as a BlockNote collab doc — MCP writes a single paragraph block. " +
          "This will overwrite collab content; use only when setting from scratch or the doc is empty.",
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
    update_title: ["applicationId", "title"],
    update_details: ["applicationId"],
    assign_meeter: ["applicationId"],
    save_eval: ["applicationId"],
    save_acceptance: ["applicationId"],
    add_note: ["applicationId", "body"],
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

  // ── update_status ─────────────────────────────────────────────────────────
  if (action === "update_status") {
    const status = input.status as string;
    if (!isPartnerApplicationStatus(status)) {
      throw new McpInvalidError(
        `Invalid status '${status}'. Valid values: ${PARTNER_APPLICATION_STATUSES.join(", ")}`,
      );
    }
    // Route through setApplicationStatus so a StatusChanged PartnerActivity row
    // is written (mirrors api.partner-applications.$id.status.ts + the web
    // status intent). A bare prisma.update leaves the application timeline with
    // no record of who changed the status or when. Note: transactional CRM
    // side effects (partner-facing accept/reject/etc. emails) stay web-only.
    const prev = await setApplicationStatus(prisma, {
      applicationId: input.applicationId as string,
      to: status,
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

  // ── assign_meeter ─────────────────────────────────────────────────────────
  if (action === "assign_meeter") {
    const applicationId = input.applicationId as string;
    // Empty string explicitly clears the assignment; undefined/null also clears.
    const meeterId =
      typeof input.assignedMeeterId === "string" && input.assignedMeeterId.trim()
        ? input.assignedMeeterId.trim()
        : null;
    try {
      await prisma.partnerApplication.update({
        where: { id: applicationId },
        data: { assignedMeeterId: meeterId },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2025") {
        throw new McpNotFoundError(`Partner application ${applicationId} not found`);
      }
      throw e;
    }
    return { ok: true };
  }

  // ── save_eval ─────────────────────────────────────────────────────────────
  if (action === "save_eval") {
    const applicationId = input.applicationId as string;

    // Validate and extract criterion scores from the evalScores object.
    const rubric: Record<string, unknown> = {};
    const criterionKeys = new Set<string>(EVAL_CRITERIA.map((c) => c.key));
    const scoresRaw =
      input.evalScores && typeof input.evalScores === "object"
        ? (input.evalScores as Record<string, unknown>)
        : {};
    for (const [key, val] of Object.entries(scoresRaw)) {
      if (!criterionKeys.has(key)) {
        throw new McpInvalidError(
          `Unknown criterion key '${key}'. Valid keys: ${[...criterionKeys].join(", ")}`,
        );
      }
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        throw new McpInvalidError(`Score for '${key}' must be an integer 1–5`);
      }
      rubric[key as EvalCriterionKey] = n;
    }

    const notes =
      typeof input.evalNotes === "string" ? input.evalNotes.trim() : undefined;
    if (notes) rubric.notes = notes;
    rubric.criteriaVersion = EVAL_CRITERIA_VERSION;

    const interviewRatingRaw = input.interviewRating;
    const interviewRating =
      typeof interviewRatingRaw === "number"
        ? Math.min(5, Math.max(1, Math.round(interviewRatingRaw)))
        : null;

    try {
      await prisma.partnerApplication.update({
        where: { id: applicationId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { evalRubric: rubric as any, ...(interviewRating !== null ? { interviewRating } : {}) },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2025") {
        throw new McpNotFoundError(`Partner application ${applicationId} not found`);
      }
      throw e;
    }
    await logPartnerActivity(prisma, {
      applicationId,
      actorUserId: callerId,
      type: "Evaluated",
      ...(interviewRating !== null ? { metadata: { interviewRating } } : {}),
    });
    return { ok: true };
  }

  // ── save_acceptance ────────────────────────────────────────────────────────
  if (action === "save_acceptance") {
    const applicationId = input.applicationId as string;

    const ambiguityRaw = input.ambiguityRating;
    const ambiguityRating =
      typeof ambiguityRaw === "number"
        ? Math.min(5, Math.max(1, Math.round(ambiguityRaw)))
        : undefined;
    const fundingModel =
      typeof input.fundingModel === "string"
        ? input.fundingModel.trim() || null
        : undefined;

    if (ambiguityRating === undefined && fundingModel === undefined) {
      throw new McpInvalidError(
        "save_acceptance requires at least one of: ambiguityRating, fundingModel",
      );
    }
    try {
      await prisma.partnerApplication.update({
        where: { id: applicationId },
        data: {
          ...(ambiguityRating !== undefined ? { ambiguityRating } : {}),
          ...(fundingModel !== undefined ? { fundingModel } : {}),
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2025") {
        throw new McpNotFoundError(`Partner application ${applicationId} not found`);
      }
      throw e;
    }
    return { ok: true };
  }

  // ── add_note ──────────────────────────────────────────────────────────────
  if (action === "add_note") {
    const applicationId = input.applicationId as string;
    const body = (input.body as string).trim();
    if (!body) throw new McpInvalidError("Note body cannot be empty");

    // Verify the application exists before logging.
    const exists = await prisma.partnerApplication.findUnique({
      where: { id: applicationId },
      select: { id: true },
    });
    if (!exists) throw new McpNotFoundError(`Partner application ${applicationId} not found`);

    await logPartnerActivity(prisma, {
      applicationId,
      actorUserId: callerId,
      type: "Note",
      body,
    });
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

    // expectedChallenges is a collab block doc on the web (BlockNote JSON
    // stored in PartnerApplicationDomain.expectedChallenges). MCP writes a
    // plain-text paragraph block. This will overwrite any existing collab
    // content — only use when setting from scratch or the doc is known empty.
    // COLLAB-BODY FLAG: write goes through a direct Prisma update, not the
    // Hocuspocus pipeline, so it will not be broadcast to live editing sessions.
    let expectedChallengesBlock: unknown = undefined;
    if (typeof input.expectedChallenges === "string" && input.expectedChallenges.trim()) {
      expectedChallengesBlock = [
        {
          id: "mcp-challenges-1",
          type: "paragraph",
          props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
          content: [{ type: "text", text: input.expectedChallenges.trim(), styles: {} }],
          children: [],
        },
      ];
    }

    await prisma.partnerApplicationDomain.update({
      where: { id: applicationDomainId },
      data: {
        ...(expectedMembers !== undefined ? { expectedMembers } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(expectedChallengesBlock !== undefined ? { expectedChallenges: expectedChallengesBlock as any } : {}),
      },
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
