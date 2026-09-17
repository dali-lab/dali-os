// MCP tool: get_certificate — read certificate fields.
// Reuses getCertificate from certificates.server.ts.
// Access: the certificate owner, any offering manager for the issuing offering,
// or Core — mirrors the web's requireEnrollment + manager check.
// Scope: mcp:read.

import { getCertificate } from "~/education/lib/certificates.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { isCore } from "~/lib/roles";
import {
  McpForbiddenError,
  McpNotFoundError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const GET_CERTIFICATE_TOOL = {
  name: "get_certificate",
  description:
    "Read a completion certificate. Accessible to the certificate owner, any instructor/manager of the issuing offering, or Core.",
  inputSchema: {
    type: "object" as const,
    properties: {
      certificateId: { type: "string", minLength: 1 },
    },
    required: ["certificateId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Args = { certificateId: string };

export async function runGetCertificate(ctx: McpCtx, args: Args) {
  const cert = await getCertificate(args.certificateId);
  if (!cert) throw new McpNotFoundError("Certificate not found");

  const callerId = ctx.user.id;
  const isOwner = cert.applicantUserId === callerId;
  const [manager, core] = await Promise.all([
    isOwner ? Promise.resolve(false) : isOfferingManager(callerId, cert.offeringId),
    isOwner ? Promise.resolve(false) : isCore(callerId),
  ]);

  if (!isOwner && !manager && !core) {
    throw new McpForbiddenError();
  }

  return {
    id: cert.id,
    issuedAt: cert.issuedAt.toISOString(),
    studentName: cert.studentName,
    offeringId: cert.offeringId,
    offeringTitle: cert.offeringTitle,
    offeringType: cert.offeringType,
    startsAt: cert.startsAt ? cert.startsAt.toISOString() : null,
    endsAt: cert.endsAt ? cert.endsAt.toISOString() : null,
    instructorNames: cert.instructorNames,
    feedback: cert.feedback,
  };
}

export const GET_CERTIFICATE: McpTool = {
  def: GET_CERTIFICATE_TOOL,
  run: (ctx: McpCtx, args) => runGetCertificate(ctx, args as Args),
};
