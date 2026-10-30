import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.announcements";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db.server";
import { listVisibleGroupsForUser } from "~/lib/groups";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { fullName } from "~/lib/display";
import { AnnouncementsPage } from "~/core/components/AnnouncementsPage";
import { audienceLabel, countSentAnnouncements, loadSentAnnouncements } from "~/core/lib/announcements-sent.server";
import { regroupRedirect } from "~/core/lib/regroup-redirect.server";

export const handle = adminHandle("announcements");

export const meta: Route.MetaFunction = () => [
  { title: "Announcements · Core · DALI OS" },
];

// Admin composer: write an announcement or a todo and send it to the whole
// lab, specific people, or a user group, with an optional due date and an
// optional attached published form. Sending fans out via the shared
// /api/notifications/send endpoint (one Notification row per recipient).

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const regrouped = await regroupRedirect(
    request,
    auth.user.sub,
    "/admin/announcements",
    "/core/communications/announcements",
  );
  if (regrouped) return regrouped;
  if (!(await isCore(auth.user.sub))) return redirect("/");

  // Recipient picker + the "Whole lab" count are the current-members audience:
  // a DALIMember who is Active (not an alumnus). Term-independent so it matches
  // resolveAllLabMembers on the send side and reaches members with no
  // assignments this term yet (e.g. next-term hires). Alumni are excluded here —
  // reach them via the "Alumni" group instead.
  const [users, visibleGroups, forms, scheduledRows] = await Promise.all([
    prisma.user.findMany({
      where: { daliMember: { isNot: null }, membershipStatus: "Active" },
      orderBy: MEMBER_LIST_ORDER_BY,
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    }),
    listVisibleGroupsForUser(auth.user.sub),
    prisma.form.findMany({
      where: { published: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Pending sends plus recently fired-with-error rows (so a fire-time
    // failure — e.g. the attached form got unpublished — is visible here).
    prisma.scheduledAnnouncement.findMany({
      where: {
        canceledAt: null,
        OR: [{ sentAt: null }, { lastError: { not: null } }],
      },
      orderBy: { sendAt: "asc" },
      take: 20,
    }),
  ]);

  const groupById = new Map(visibleGroups.map((g) => [g.id, g]));
  const [sentPage, sentTotal, authors] = await Promise.all([
    loadSentAnnouncements(null, groupById),
    countSentAnnouncements(),
    prisma.user.findMany({
      where: { id: { in: [...new Set(scheduledRows.map((r) => r.createdByUserId))] } },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  const authorById = new Map(authors.map((a) => [a.id, fullName(a) || "Core"]));
  const memberIds = users.map((u) => u.id);

  const describe = (r: (typeof scheduledRows)[number]) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    author: authorById.get(r.createdByUserId) ?? "Core",
    audience: audienceLabel(r, groupById),
    sendAt: r.sendAt.toISOString(),
    dueAt: r.dueAt?.toISOString() ?? null,
    ccDartmouth: r.ccDartmouth,
  });

  return {
    members: users.map((u) => ({
      id: u.id,
      name: fullName(u),
      email: u.daliEmail,
    })),
    groups: visibleGroups.map((g) => ({
      id: g.id,
      name: g.name,
      systemKey: g.systemKey,
      memberCount: g.memberIds.length,
    })),
    publishedForms: forms,
    scheduled: scheduledRows.map((s) => ({
      ...describe(s),
      lastError: s.lastError,
      recipients: estimateRecipients(s, memberIds, groupById),
    })),
    sent: sentPage.items,
    sentNextCursor: sentPage.nextCursor,
    sentTotal,
    viewerIsAdmin: await isAdmin(auth.user.sub),
  };
}

type AudienceRow = { allMembers: boolean; groupIds: string[]; userIds: string[] };

/** Who a scheduled send would reach if it went out now. Groups can change before it fires. */
export function estimateRecipients(
  r: AudienceRow,
  memberIds: string[],
  groupById: Map<string, { memberIds: string[] }>,
): number {
  const ids = new Set(r.userIds);
  if (r.allMembers) memberIds.forEach((id) => ids.add(id));
  for (const gid of r.groupIds) groupById.get(gid)?.memberIds.forEach((id) => ids.add(id));
  return ids.size;
}

// Cancel a pending scheduled announcement. The updateMany's sentAt guard
// races cleanly with the job's CAS claim — whichever lands first wins.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const form = await request.formData();
  if (String(form.get("intent")) !== "cancel-scheduled") {
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }
  const id = String(form.get("id") ?? "");
  const pending = await prisma.scheduledAnnouncement.findUnique({
    where: { id },
    select: { title: true, sendAt: true },
  });
  const result = await prisma.scheduledAnnouncement.updateMany({
    where: { id, sentAt: null, canceledAt: null },
    data: { canceledAt: new Date() },
  });
  if (result.count === 1) {
    await logAuditEvent({
      action: "announcement.cancel",
      userId: auth.user.sub,
      targetId: id,
      metadata: { title: pending?.title ?? null, sendAt: pending?.sendAt.toISOString() ?? null },
      request,
    });
  }
  return { ok: true, canceled: result.count === 1 };
}


export default function AnnouncementsRoute() {
  return <AnnouncementsPage data={useLoaderData<typeof loader>()} />;
}
