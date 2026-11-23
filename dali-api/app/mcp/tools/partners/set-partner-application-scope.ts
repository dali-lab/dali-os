import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
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

export const SET_PARTNER_APPLICATION_SCOPE_TOOL = {
  name: "set_partner_application_scope",
  description:
    "Set what a partner application covers (Core only): the application form binding and the domains on an application.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["set_form", "clear_form", "add_domain", "update_domain_scope", "remove_domain"],
        description: "What to do.",
      },
      applicationId: { type: "string", description: "Required for add_domain." },
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
          "Plain-text expected challenges for this domain (update_domain_scope). " +
          "The web UI stores this as a BlockNote collab doc; MCP writes a single paragraph block and overwrites existing content, so use it only when the doc is empty.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runSetPartnerApplicationScope(
  callerId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!(await isCore(callerId))) {
    throw new McpForbiddenError("Only Core members can manage partner applications");
  }

  const action = input.action as string;

  requireForAction(action, input, {
    set_form: ["formId"],
    clear_form: [],
    add_domain: ["applicationId", "domainId"],
    update_domain_scope: ["applicationDomainId"],
    remove_domain: ["applicationDomainId"],
  });

  if (action === "set_form") {
    const result = await setApplicationFormBinding(input.formId as string, callerId);
    if (!result.ok) throw new McpInvalidError(result.error);
    return { ok: true };
  }

  if (action === "clear_form") {
    await clearApplicationFormBinding();
    return { ok: true };
  }

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

  const applicationDomainId = input.applicationDomainId as string;

  if (action === "update_domain_scope") {
    const existing = await prisma.partnerApplicationDomain.findUnique({
      where: { id: applicationDomainId },
      select: { id: true },
    });
    if (!existing) throw new McpNotFoundError(`Application domain ${applicationDomainId} not found`);

    const expectedMembers =
      typeof input.expectedMembers === "number"
        ? Math.max(0, Math.floor(input.expectedMembers))
        : undefined;

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
