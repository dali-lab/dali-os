import { prisma } from "~/lib/db";
import { getFrontendUrl } from "~/lib/app-env";
import {
  sendPartnerApplicationDecisionEmail,
  sendPartnerDocumentSharedEmail,
  sendPartnerPartnershipEndedEmail,
  sendPartnerProjectLinkedEmail,
} from "./partner-emails.server";

// Partner-facing lifecycle notifications. Kept OUT of partner-access.ts (which
// must stay prisma-only for the collab-auth path) and off the notify()
// preference layer (partners aren't members) — this is the direct partner
// email pipeline, fanned out to every teammate. Every function is best-effort:
// a send failure is logged, never thrown, so it can't block the mutation that
// triggered it.

async function orgRecipients(partnerOrgId: string): Promise<string[]> {
  const users = await prisma.partnerUser.findMany({
    where: { partnerOrgId },
    select: { user: { select: { personalEmail: true } } },
  });
  return users
    .map((u) => u.user.personalEmail)
    .filter((e): e is string => Boolean(e));
}

// Everyone across all orgs with an (existing) partnership on the project.
async function projectPartnerRecipients(projectId: string): Promise<string[]> {
  const links = await prisma.projectPartner.findMany({
    where: { projectId },
    select: {
      partnerOrg: {
        select: { users: { select: { user: { select: { personalEmail: true } } } } },
      },
    },
  });
  const emails = links.flatMap((l) =>
    l.partnerOrg.users.map((u) => u.user.personalEmail),
  );
  return [...new Set(emails.filter((e): e is string => Boolean(e)))];
}

const DECISION_STATUSES = new Set(["Accepted", "Rejected", "OnHold"]);

// Fire on a status transition into a decision state (Accepted/Rejected/OnHold).
// No-op for other statuses (incl. partner-initiated Withdrawn) so partners
// aren't pinged mid-triage or about their own action. Reads the persisted
// decisionNote, so callers only need to set status+note before calling.
export async function notifyPartnerApplicationDecision(params: {
  applicationId: string;
  status: string;
}): Promise<void> {
  if (!DECISION_STATUSES.has(params.status)) return;
  try {
    const app = await prisma.partnerApplication.findUnique({
      where: { id: params.applicationId },
      select: { title: true, partnerOrgId: true, decisionNote: true },
    });
    if (!app) return;
    const to = await orgRecipients(app.partnerOrgId);
    const viewUrl = `${getFrontendUrl()}/partner/applications/${params.applicationId}`;
    await Promise.allSettled(
      to.map((email) =>
        sendPartnerApplicationDecisionEmail(
          email,
          app.title,
          params.status as "Accepted" | "Rejected" | "OnHold",
          app.decisionNote,
          viewUrl,
        ),
      ),
    );
  } catch (err) {
    console.error("notifyPartnerApplicationDecision failed", err);
  }
}

// Fire when a project becomes available to a partner org (promotion or a
// manual link). Scoped to the org that was just linked.
export async function notifyPartnerProjectLinked(params: {
  projectId: string;
  partnerOrgId: string;
  projectName: string;
}): Promise<void> {
  try {
    const to = await orgRecipients(params.partnerOrgId);
    const viewUrl = `${getFrontendUrl()}/partner/projects/${params.projectId}`;
    await Promise.allSettled(
      to.map((email) =>
        sendPartnerProjectLinkedEmail(email, params.projectName, viewUrl),
      ),
    );
  } catch (err) {
    console.error("notifyPartnerProjectLinked failed", err);
  }
}

// Fire when a page or file is newly shared with a project's partners.
// `href` is the portal path to the doc/file (a page route, or the project hub
// for files, which preview in-place).
export async function notifyPartnerDocumentShared(params: {
  projectId: string;
  docTitle: string;
  href: string;
}): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { name: true },
    });
    if (!project) return;
    const to = await projectPartnerRecipients(params.projectId);
    if (to.length === 0) return;
    const viewUrl = `${getFrontendUrl()}${params.href}`;
    await Promise.allSettled(
      to.map((email) =>
        sendPartnerDocumentSharedEmail(
          email,
          params.docTitle,
          project.name,
          viewUrl,
        ),
      ),
    );
  } catch (err) {
    console.error("notifyPartnerDocumentShared failed", err);
  }
}

// Fire when a partnership on a project ends or is unlinked (access revoked).
export async function notifyPartnerPartnershipEnded(params: {
  partnerOrgId: string;
  projectName: string;
}): Promise<void> {
  try {
    const to = await orgRecipients(params.partnerOrgId);
    await Promise.allSettled(
      to.map((email) =>
        sendPartnerPartnershipEndedEmail(email, params.projectName),
      ),
    );
  } catch (err) {
    console.error("notifyPartnerPartnershipEnded failed", err);
  }
}
