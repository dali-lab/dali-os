import { getClientIp } from "~/lib/rate-limit";
import type { Prisma } from "~/generated/prisma/client";

// The closed set of action strings written to AuditLog. Exported as an array
// so the activity-log UI can render a filter dropdown without having to scan
// the table for distinct values.
export const AUDIT_ACTIONS = [
  "login.success",
  "login.failure",
  "logout",
  "auth.token.invalid",
  "auth.token.malformed",
  "pairing.start",
  "pairing.approve",
  "pairing.cancel",
  "pairing.consume",
  "pairing.handoff",
  "role.change",
  "decision.finalize",
  "decision.release",
  "waitlist.accept",
  "waitlist.remove",
  "interview.invite-reminder.sent",
  "interview.complete",
  "interview.reopen",
  "interview.reassign",
  "interview.decline",
  "review.submit",
  "review.unsubmit",
  "domain.create",
  "domain.delete",
  "domain.lead.add",
  "domain.lead.remove",
  "group.create",
  "group.update",
  "group.delete",
  "staffing.assign",
  "staffing.finalize",
  "staffing.term_channel",
  "staffing.sync_teams",
  "staffing.board-member.add",
  "staffing.board-member.remove",
  "staffing.reorder",
  "project.assignment.level",
  "slack.connect",
  "slack.disconnect",
  "account.linked",
  "document.delete",
  "projectFile.create",
  "projectFile.version",
  "projectFile.delete",
  "doctag.create",
  "email.send",
  "email.extension_notice",
  "confidentiality.sign",
  "mcp.tool_called",
  "mcp.resource_read",
  "mcp.prompt_rendered",
  "partner.org.create",
  "partner.org.update",
  "partner.org.delete",
  "partner.member.update",
  "partner.member.remove",
  "partner.project.link",
  "partner.project.update",
  "partner.project.unlink",
  "partner.invited",
  "partner.invite.accepted",
  "partner.invite.revoked",
  "partner.application.submitted",
  "partner.magic_link.requested",
  "page.partner-visibility",
  "education.offering.create",
  "education.offering.update",
  "education.offering.status",
  "education.offering.delete",
  "education.offering.close-out",
  "education.session.create",
  "education.session.update",
  "education.session.delete",
  "education.instructors.set",
  "education.application.submit",
  "education.application.withdraw",
  "education.application.decision",
  "education.waitlist.promote",
  "education.attendance.update",
  "education.announcement.create",
  "education.discussion.post",
  "education.discussion.delete",
  "education.assignment.create",
  "education.assignment.update",
  "education.assignment.delete",
  "education.submission.submit",
  "education.submission.grade",
  "education.note.update",
  "education.certificate.issue",
  "education.cecredit.grant",
  "education.cecredit.revoke",
  "education.decision-email.bind",
  "education.form-binding.set",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEvent = {
  action: AuditAction;
  userId?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  request?: Request;
  ip?: string | null;
  userAgent?: string | null;
};

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    const ip =
      event.ip ?? (event.request ? getClientIp(event.request) : null);
    const userAgent =
      event.userAgent ??
      (event.request ? event.request.headers.get("User-Agent") : null);

    // Lazy-imported so tests that only mock ~/lib/auth (or other transitive
    // importers of this module) don't have to also mock the prisma client.
    const { prisma } = await import("~/lib/db");

    await prisma.auditLog.create({
      data: {
        action: event.action,
        userId: event.userId ?? null,
        targetId: event.targetId ?? null,
        metadata: event.metadata,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    });
  } catch (err) {
    console.error("audit log write failed", {
      action: event.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
