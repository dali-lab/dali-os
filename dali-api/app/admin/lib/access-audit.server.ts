import { logAuditEvent } from "~/lib/audit";

export type RoleLabel = string;

export function logRoleChange(args: {
  actorId: string;
  targetUserId: string;
  before: RoleLabel[];
  after: RoleLabel[];
  request: Request;
}) {
  return logAuditEvent({
    action: "role.change",
    userId: args.actorId,
    targetId: args.targetUserId,
    metadata: {
      before: args.before,
      after: args.after,
      targetUserId: args.targetUserId,
    },
    request: args.request,
  });
}

export function logDomainLeadChange(args: {
  kind: "add" | "remove";
  actorId: string;
  targetUserId: string;
  domainId: string | undefined;
  assignmentId: string;
  termId: string;
  request: Request;
}) {
  return logAuditEvent({
    action: args.kind === "add" ? "domain.lead.add" : "domain.lead.remove",
    userId: args.actorId,
    targetId: args.targetUserId,
    metadata: {
      domainId: args.domainId,
      assignmentId: args.assignmentId,
      termId: args.termId,
    },
    request: args.request,
  });
}
