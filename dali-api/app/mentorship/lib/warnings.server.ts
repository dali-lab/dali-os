import { prisma } from "~/lib/db.server";
import { redirect } from "react-router";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

export async function warningsEnabledFor(userId: string, request: Request): Promise<boolean> {
  const roles = await getUserRoles(userId, request);
  return roles.isCore && (await isFeatureEnabled("mentorship-warnings", userId, roles, request));
}

export async function warningsFlagOn(userId: string, request: Request): Promise<boolean> {
  const roles = await getUserRoles(userId, request);
  return isFeatureEnabled("mentorship-warnings", userId, roles, request);
}

export async function requireWarningsAdmin(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");
  const roles = await getUserRoles(auth.user.sub, request);
  if (!(await isFeatureEnabled("mentorship-warnings", auth.user.sub, roles, request))) {
    throw new Response("Not found", { status: 404 });
  }
  if (!(await isCore(auth.user.sub))) throw new Response("Forbidden", { status: 403 });
  return auth.user.sub;
}

/** Core can warn about anyone; a mentor only about a mentee they are paired with. */
export async function canWarnMember(userId: string, memberId: string): Promise<boolean> {
  if (await isCore(userId)) return true;
  const pair = await prisma.mentorshipPair.findFirst({
    where: { mentorUserId: userId, menteeUserId: memberId },
    select: { id: true },
  });
  return pair != null;
}

export async function openWarningMemberIds(): Promise<string[]> {
  const rows = await prisma.mentorshipWarning.findMany({
    where: { status: "open" },
    select: { memberId: true },
    distinct: ["memberId"],
  });
  return rows.map((r) => r.memberId);
}

export type MemberWarningCase = {
  id: string;
  reason: string;
  notes: string;
  occurredOn: string;
  termCode: string | null;
  status: "open" | "resolved";
  submittedBy: string | null;
  investigatorId: string;
  linkUrl: string;
  willAcceptReapp: "" | "yes" | "no";
  stage: string;
  meeting1On: string;
  meeting1Notes: string;
  meeting2On: string;
  meeting2Notes: string;
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export async function loadMemberWarnings(memberId: string): Promise<{
  warnings: MemberWarningCase[];
  people: { id: string; name: string }[];
}> {
  const [rows, users, terms] = await Promise.all([
    prisma.mentorshipWarning.findMany({
      where: { memberId },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    }),
    prisma.user.findMany({
      where: { membershipStatus: "Active" },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.term.findMany({ select: { code: true, startDate: true, endDate: true } }),
  ]);
  const termFor = (d: Date) => terms.find((t) => t.startDate <= d && d <= t.endDate)?.code ?? null;
  return {
    warnings: rows.map((w) => ({
      id: w.id,
      reason: w.reason,
      notes: w.notes,
      occurredOn: iso(w.occurredOn),
      termCode: termFor(w.occurredOn),
      status: w.status === "resolved" ? "resolved" : "open",
      submittedBy: w.createdBy ? `${w.createdBy.firstName} ${w.createdBy.lastName}`.trim() : null,
      investigatorId: w.investigatorId ?? "",
      linkUrl: w.linkUrl,
      willAcceptReapp: w.willAcceptReapp == null ? "" : w.willAcceptReapp ? "yes" : "no",
      stage: w.stage,
      meeting1On: iso(w.meeting1On),
      meeting1Notes: w.meeting1Notes,
      meeting2On: iso(w.meeting2On),
      meeting2Notes: w.meeting2Notes,
    })),
    people: users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() })),
  };
}
