import { prisma } from "~/lib/db";
import { currentTerm, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { notifyAdminsOfPromotion } from "~/lib/promotion-notify.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { peopleByNetId } from "~/lib/dartmouth-people";
import { manageableOfferingIds, isOfferingManager } from "./access.server";
import { notifyExternalInstructorInvite } from "./notifications.server";
import { createOfferingApplicationForm } from "./application-form.server";
import type { OfferingStatus, OfferingType } from "~/generated/prisma/client";

// ─── Reads ───────────────────────────────────────────────────────────────────

const offeringListInclude = {
  instructors: {
    select: {
      userId: true,
      user: { select: { firstName: true, lastName: true, photoUrl: true } },
    },
  },
  sessions: {
    orderBy: { sequence: "asc" as const },
    select: { id: true, datetime: true },
  },
};

export type CatalogOffering = Awaited<ReturnType<typeof listCatalog>>[number];

/**
 * Published offerings for the catalog, plus per-offering approved counts and
 * (when `userId` is given) the caller's own application status.
 */
export async function listCatalog(userId?: string) {
  const offerings = await prisma.educationOffering.findMany({
    where: { status: "Published" },
    include: offeringListInclude,
    orderBy: { startsAt: "asc" },
  });
  const counts = await approvedCounts(offerings.map((o) => o.id));
  const mine = userId
    ? await prisma.educationApplication.findMany({
        where: { applicantUserId: userId, offeringId: { in: offerings.map((o) => o.id) } },
        select: { offeringId: true, status: true },
      })
    : [];
  const mineByOffering = new Map(mine.map((a) => [a.offeringId, a.status]));

  // Open (unsubmitted, not past-due) assignments per enrolled offering, so
  // waiting work is visible from the catalog instead of buried in the hub.
  const approvedIds = mine
    .filter((a) => a.status === "Approved")
    .map((a) => a.offeringId);
  const openByOffering = new Map<string, number>();
  if (userId && approvedIds.length > 0) {
    const assignments = await prisma.educationAssignment.findMany({
      where: {
        OR: [
          { offeringId: { in: approvedIds } },
          { session: { offeringId: { in: approvedIds } } },
        ],
      },
      select: {
        id: true,
        dueAt: true,
        offeringId: true,
        session: { select: { offeringId: true } },
      },
    });
    const submitted = new Set(
      (
        await prisma.educationSubmission.findMany({
          where: {
            studentId: userId,
            assignmentId: { in: assignments.map((a) => a.id) },
          },
          select: { assignmentId: true },
        })
      ).map((s) => s.assignmentId),
    );
    const now = new Date();
    for (const a of assignments) {
      if (submitted.has(a.id)) continue;
      if (a.dueAt && a.dueAt <= now) continue;
      const oid = a.offeringId ?? a.session?.offeringId;
      if (!oid) continue;
      openByOffering.set(oid, (openByOffering.get(oid) ?? 0) + 1);
    }
  }

  return resolveInstructorPhotos(
    offerings.map((o) => ({
      ...shapeOffering(o),
      approvedCount: counts.get(o.id) ?? 0,
      myStatus: mineByOffering.get(o.id) ?? null,
      openAssignments: openByOffering.get(o.id) ?? 0,
    })),
  );
}

/**
 * Every application the caller has made, across all offerings, newest first.
 * The "My applications" history — includes Rejected/Withdrawn and offerings that
 * have since been archived or closed out, which drop out of the live catalog.
 */
export async function listMyApplications(userId: string) {
  const apps = await prisma.educationApplication.findMany({
    where: { applicantUserId: userId },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      offering: {
        select: { id: true, title: true, type: true, endsAt: true, closedOutAt: true },
      },
      certificate: { select: { id: true } },
    },
  });
  return apps.map((a) => ({
    id: a.id,
    status: a.status,
    submittedAt: a.submittedAt,
    offeringId: a.offering.id,
    offeringTitle: a.offering.title,
    offeringType: a.offering.type,
    endsAt: a.offering.endsAt,
    closedOutAt: a.offering.closedOutAt,
    certificateId: a.certificate?.id ?? null,
  }));
}

/** Offerings the user can manage, all statuses. Core sees everything. */
export async function listManageable(userId: string) {
  const ids = await manageableOfferingIds(userId);
  if (ids !== "all" && ids.length === 0) return [];
  const offerings = await prisma.educationOffering.findMany({
    where: ids === "all" ? {} : { id: { in: ids } },
    include: offeringListInclude,
    orderBy: { createdAt: "desc" },
  });
  const counts = await approvedCounts(offerings.map((o) => o.id));
  const pending = await prisma.educationApplication.groupBy({
    by: ["offeringId"],
    where: { offeringId: { in: offerings.map((o) => o.id) }, status: "Submitted" },
    _count: { _all: true },
  });
  const pendingByOffering = new Map(pending.map((p) => [p.offeringId, p._count._all]));
  return resolveInstructorPhotos(
    offerings.map((o) => ({
      ...shapeOffering(o),
      approvedCount: counts.get(o.id) ?? 0,
      pendingCount: pendingByOffering.get(o.id) ?? 0,
    })),
  );
}

export async function getOfferingDetail(offeringId: string) {
  const offering = await prisma.educationOffering.findUnique({
    where: { id: offeringId },
    include: {
      instructors: {
        select: {
          userId: true,
          user: { select: { firstName: true, lastName: true, photoUrl: true } },
        },
      },
      sessions: { orderBy: { sequence: "asc" } },
    },
  });
  if (!offering) return null;
  const counts = await approvedCounts([offering.id]);
  const instructors = await Promise.all(
    offering.instructors.map(async (i) => ({
      userId: i.userId,
      name: `${i.user.firstName} ${i.user.lastName}`.trim(),
      photoUrl: await resolvePhotoUrl(i.user.photoUrl),
    })),
  );
  return {
    ...offering,
    approvedCount: counts.get(offering.id) ?? 0,
    instructors,
  };
}

async function approvedCounts(offeringIds: string[]) {
  if (offeringIds.length === 0) return new Map<string, number>();
  const rows = await prisma.educationApplication.groupBy({
    by: ["offeringId"],
    where: { offeringId: { in: offeringIds }, status: "Approved" },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.offeringId, r._count._all]));
}

function shapeOffering(o: {
  id: string;
  type: OfferingType;
  title: string;
  status: OfferingStatus;
  capacity: number;
  requiresReview: boolean;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  startsAt: Date;
  endsAt: Date;
  closedOutAt: Date | null;
  instructors: {
    userId: string;
    user: { firstName: string; lastName: string; photoUrl: string | null };
  }[];
  sessions: { id: string; datetime: Date }[];
}) {
  return {
    id: o.id,
    type: o.type,
    title: o.title,
    status: o.status,
    capacity: o.capacity,
    requiresReview: o.requiresReview,
    registrationOpensAt: o.registrationOpensAt,
    registrationClosesAt: o.registrationClosesAt,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    closedOutAt: o.closedOutAt,
    sessionCount: o.sessions.length,
    // Kept as plain strings for the cert/PDF servers that render names only.
    instructorNames: o.instructors.map((i) =>
      `${i.user.firstName} ${i.user.lastName}`.trim(),
    ),
    // `photoUrl` here is the raw stored value — resolveInstructorPhotos() swaps
    // it for a ready avatar src page-wide (de-duped) before it reaches a card.
    instructors: o.instructors.map((i) => ({
      userId: i.userId,
      name: `${i.user.firstName} ${i.user.lastName}`.trim(),
      photoUrl: i.user.photoUrl,
    })),
  };
}

// Resolve every distinct instructor avatar across a page of offerings once,
// then swap the raw keys for ready srcs. Instructors repeat heavily across a
// term's catalog, so de-duping by userId keeps this to a handful of presigns
// rather than one per (offering × instructor).
async function resolveInstructorPhotos<
  T extends { instructors: { userId: string; photoUrl: string | null }[] },
>(offerings: T[]): Promise<T[]> {
  const rawByUser = new Map<string, string | null>();
  for (const o of offerings) {
    for (const i of o.instructors) rawByUser.set(i.userId, i.photoUrl);
  }
  const resolved = new Map(
    await Promise.all(
      [...rawByUser].map(
        async ([userId, raw]) => [userId, await resolvePhotoUrl(raw)] as const,
      ),
    ),
  );
  return offerings.map((o) => ({
    ...o,
    instructors: o.instructors.map((i) => ({
      ...i,
      photoUrl: resolved.get(i.userId) ?? null,
    })),
  }));
}

// ─── Lightweight home-card summary ───────────────────────────────────────────

/**
 * Count-only summary of a user's education activity, for the home card.
 * Uses groupBy/count/aggregate instead of fetching full offering/session/
 * instructor rows, so it's much cheaper than listCatalog.
 */
export async function getHomeEducationSummary(userId: string): Promise<{
  enrolledCount: number;
  openOfferings: number;
  pendingCount: number;
  openAssignments: number;
}> {
  const now = new Date();

  const [myApps, openOfferingsCount] = await Promise.all([
    // All the user's applications against currently-Published offerings.
    prisma.educationApplication.findMany({
      where: {
        applicantUserId: userId,
        offering: { status: "Published" },
      },
      select: { offeringId: true, status: true },
    }),
    // Published offerings with registration window open right now.
    prisma.educationOffering.count({
      where: {
        status: "Published",
        registrationOpensAt: { lte: now },
        registrationClosesAt: { gte: now },
      },
    }),
  ]);

  const enrolledIds = myApps
    .filter((a) => a.status === "Approved")
    .map((a) => a.offeringId);
  const pendingCount = myApps.filter(
    (a) => a.status === "Submitted" || a.status === "Waitlisted",
  ).length;

  let openAssignments = 0;
  if (enrolledIds.length > 0) {
    // Count assignments that are due in the future and not yet submitted.
    const [assignmentIds, submittedIds] = await Promise.all([
      prisma.educationAssignment.findMany({
        where: {
          dueAt: { gt: now },
          OR: [
            { offeringId: { in: enrolledIds } },
            { session: { offeringId: { in: enrolledIds } } },
          ],
        },
        select: { id: true },
      }),
      prisma.educationSubmission.findMany({
        where: {
          studentId: userId,
          assignment: {
            OR: [
              { offeringId: { in: enrolledIds } },
              { session: { offeringId: { in: enrolledIds } } },
            ],
          },
        },
        select: { assignmentId: true },
      }),
    ]);
    const submittedSet = new Set(submittedIds.map((s) => s.assignmentId));
    openAssignments = assignmentIds.filter((a) => !submittedSet.has(a.id)).length;
  }

  return {
    enrolledCount: enrolledIds.length,
    openOfferings: openOfferingsCount,
    pendingCount,
    openAssignments,
  };
}

// ─── Registration-window helper ──────────────────────────────────────────────

export function registrationOpen(
  o: { status: OfferingStatus; registrationOpensAt: Date; registrationClosesAt: Date },
  now = new Date(),
): boolean {
  return (
    o.status === "Published" &&
    o.registrationOpensAt <= now &&
    now <= o.registrationClosesAt
  );
}

// ─── Mutations (form-intent dispatch, mirrors forms-data.ts) ────────────────

type ActionResult = { ok: true; id?: string } | { error: string; status: number };

const bad = (error: string, status = 400): ActionResult => ({ error, status });

function parseDate(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function validateDates(o: {
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  startsAt: Date;
  endsAt: Date;
}): string | null {
  if (o.registrationOpensAt >= o.registrationClosesAt)
    return "Registration must open before it closes";
  if (o.registrationClosesAt > o.startsAt)
    return "Registration must close on or before the start date";
  if (o.startsAt > o.endsAt) return "Start date must be on or before the end date";
  return null;
}

/**
 * All offering/session/instructor mutations behind one formData dispatcher.
 * Callers gate access first: `create-offering` and `set-instructors` and
 * `delete-offering` are Core-only (re-checked here since one route action
 * serves both tiers); everything else needs offering-manager.
 */
export async function runOfferingAction(
  formData: FormData,
  actorId: string,
): Promise<ActionResult> {
  const intent = formData.get("intent");

  if (intent === "create-offering") {
    if (!(await isCore(actorId))) return bad("Core only", 403);
    const type = formData.get("type");
    if (type !== "Miniseries" && type !== "Workshop") return bad("Invalid type");
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return bad("Title is required");
    const capacity = Number(formData.get("capacity"));
    if (!Number.isInteger(capacity) || capacity < 1)
      return bad("Capacity must be a positive integer");
    const dates = {
      registrationOpensAt: parseDate(formData.get("registrationOpensAt")),
      registrationClosesAt: parseDate(formData.get("registrationClosesAt")),
      startsAt: parseDate(formData.get("startsAt")),
      endsAt: parseDate(formData.get("endsAt")),
    };
    if (Object.values(dates).some((d) => d === null)) return bad("All dates are required");
    const dateError = validateDates(dates as Record<keyof typeof dates, Date>);
    if (dateError) return bad(dateError);

    const offering = await prisma.educationOffering.create({
      data: {
        type,
        title,
        capacity,
        registrationOpensAt: dates.registrationOpensAt!,
        registrationClosesAt: dates.registrationClosesAt!,
        startsAt: dates.startsAt!,
        endsAt: dates.endsAt!,
        // Checkbox is authoritative: absent (unchecked) = RSVP auto-approve.
        requiresReview: formData.get("requiresReview") === "true",
        status: "Draft",
      },
      select: { id: true },
    });
    // Description doc room name, resolved by collabAuth's `eduoffering` branch.
    await prisma.educationOffering.update({
      where: { id: offering.id },
      data: { descriptionDocId: `eduoffering:${offering.id}:description` },
    });
    // Every offering gets its own application form, cloned from the education
    // template for its type. Instructors edit it at /forms/edit/:formId.
    await createOfferingApplicationForm(offering.id, actorId);
    await logAuditEvent({
      action: "education.offering.create",
      userId: actorId,
      targetId: offering.id,
      metadata: { title, type },
    });
    return { ok: true, id: offering.id };
  }

  const offeringId = String(formData.get("offeringId") ?? "");
  if (!offeringId) return bad("offeringId is required");
  const offering = await prisma.educationOffering.findUnique({
    where: { id: offeringId },
    include: { sessions: { select: { id: true } } },
  });
  if (!offering) return bad("Offering not found", 404);
  if (!(await isOfferingManager(actorId, offeringId))) return bad("Forbidden", 403);

  switch (intent) {
    case "duplicate-offering": {
      // Clone an offering for a new run: core fields + sessions + instructors,
      // a fresh application form, as a Draft. Core-only, like creating one.
      if (!(await isCore(actorId))) return bad("Core only", 403);
      const src = await prisma.educationOffering.findUnique({
        where: { id: offeringId },
        select: {
          type: true,
          title: true,
          capacity: true,
          requiresReview: true,
          calendarEmail: true,
          registrationOpensAt: true,
          registrationClosesAt: true,
          startsAt: true,
          endsAt: true,
          sessions: {
            orderBy: { sequence: "asc" },
            select: { sequence: true, title: true, datetime: true, location: true },
          },
          instructors: { select: { userId: true } },
        },
      });
      if (!src) return bad("Offering not found", 404);
      const created = await prisma.educationOffering.create({
        data: {
          type: src.type,
          title: `${src.title} (copy)`,
          capacity: src.capacity,
          requiresReview: src.requiresReview,
          calendarEmail: src.calendarEmail,
          registrationOpensAt: src.registrationOpensAt,
          registrationClosesAt: src.registrationClosesAt,
          startsAt: src.startsAt,
          endsAt: src.endsAt,
          status: "Draft",
          sessions: {
            create: src.sessions.map((s) => ({
              sequence: s.sequence,
              title: s.title,
              datetime: s.datetime,
              location: s.location,
            })),
          },
        },
        select: { id: true },
      });
      await prisma.educationOffering.update({
        where: { id: created.id },
        data: { descriptionDocId: `eduoffering:${created.id}:description` },
      });
      // Re-assign the same instructors for the current term (a clone is a fresh run).
      const cloneTerm = await currentTerm();
      if (cloneTerm && src.instructors.length > 0) {
        await prisma.instructorAssignment.createMany({
          data: src.instructors.map((i) => ({
            userId: i.userId,
            offeringId: created.id,
            termId: cloneTerm.id,
          })),
          skipDuplicates: true,
        });
      }
      await createOfferingApplicationForm(created.id, actorId);
      await logAuditEvent({
        action: "education.offering.create",
        userId: actorId,
        targetId: created.id,
        metadata: { title: `${src.title} (copy)`, type: src.type, clonedFrom: offeringId },
      });
      return { ok: true, id: created.id };
    }
    case "update-offering": {
      const title = String(formData.get("title") ?? "").trim();
      if (!title) return bad("Title is required");
      const capacity = Number(formData.get("capacity"));
      if (!Number.isInteger(capacity) || capacity < 1)
        return bad("Capacity must be a positive integer");
      const registrationOpensAt = parseDate(formData.get("registrationOpensAt"));
      const registrationClosesAt = parseDate(formData.get("registrationClosesAt"));
      const startsAt = parseDate(formData.get("startsAt"));
      const endsAt = parseDate(formData.get("endsAt"));
      if (!registrationOpensAt || !registrationClosesAt || !startsAt || !endsAt)
        return bad("All dates are required");
      const dateError = validateDates({
        registrationOpensAt,
        registrationClosesAt,
        startsAt,
        endsAt,
      });
      if (dateError) return bad(dateError);
      await prisma.educationOffering.update({
        where: { id: offeringId },
        data: {
          title,
          capacity,
          registrationOpensAt,
          registrationClosesAt,
          startsAt,
          endsAt,
          requiresReview: formData.get("requiresReview") === "true",
          calendarEmail: String(formData.get("calendarEmail") ?? "").trim() || null,
        },
      });
      await logAuditEvent({
        action: "education.offering.update",
        userId: actorId,
        targetId: offeringId,
      });
      return { ok: true, id: offeringId };
    }

    case "set-status": {
      const status = formData.get("status");
      if (status !== "Draft" && status !== "Published" && status !== "Archived")
        return bad("Invalid status");
      const allowed: Record<OfferingStatus, OfferingStatus[]> = {
        Draft: ["Published"],
        Published: ["Draft", "Archived"],
        Archived: ["Published"],
      };
      if (!allowed[offering.status].includes(status))
        return bad(`Cannot move from ${offering.status} to ${status}`);
      if (status === "Published") {
        const dateError = validateDates(offering);
        if (dateError) return bad(`Fix before publishing: ${dateError.toLowerCase()}`);
        if (offering.type === "Miniseries" && offering.sessions.length === 0)
          return bad("Add at least one session before publishing a miniseries");
      }
      await prisma.educationOffering.update({
        where: { id: offeringId },
        data: { status },
      });
      await logAuditEvent({
        action: "education.offering.status",
        userId: actorId,
        targetId: offeringId,
        metadata: { from: offering.status, to: status },
      });
      return { ok: true, id: offeringId };
    }

    case "delete-offering": {
      if (!(await isCore(actorId))) return bad("Core only", 403);
      if (offering.status !== "Draft")
        return bad("Only Draft offerings can be deleted — archive instead");
      await prisma.$transaction([
        prisma.instructorAssignment.deleteMany({ where: { offeringId } }),
        prisma.educationSession.deleteMany({ where: { offeringId } }),
        prisma.educationOffering.delete({ where: { id: offeringId } }),
      ]);
      await logAuditEvent({
        action: "education.offering.delete",
        userId: actorId,
        targetId: offeringId,
        metadata: { title: offering.title },
      });
      return { ok: true };
    }

    case "add-session": {
      const datetime = parseDate(formData.get("datetime"));
      if (!datetime) return bad("Session date/time is required");
      const last = await prisma.educationSession.findFirst({
        where: { offeringId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const session = await prisma.educationSession.create({
        data: {
          offeringId,
          sequence: (last?.sequence ?? 0) + 1,
          title: String(formData.get("title") ?? "").trim() || null,
          datetime,
          location: String(formData.get("location") ?? "").trim() || null,
          notes: String(formData.get("notes") ?? "").trim() || null,
        },
        select: { id: true },
      });
      await logAuditEvent({
        action: "education.session.create",
        userId: actorId,
        targetId: session.id,
        metadata: { offeringId },
      });
      return { ok: true, id: session.id };
    }

    case "generate-sessions": {
      // Bulk-create N sessions spaced intervalDays apart from a start — the
      // common "weekly for 6 weeks" setup, in one action instead of N.
      const start = parseDate(formData.get("startDatetime"));
      if (!start) return bad("Start date/time is required");
      const count = Math.min(
        30,
        Math.max(1, Number.parseInt(String(formData.get("count") ?? "1"), 10) || 1),
      );
      const intervalDays = Math.min(
        30,
        Math.max(1, Number.parseInt(String(formData.get("intervalDays") ?? "7"), 10) || 7),
      );
      const location = String(formData.get("location") ?? "").trim() || null;
      const last = await prisma.educationSession.findFirst({
        where: { offeringId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      let sequence = last?.sequence ?? 0;
      const rows = [];
      for (let i = 0; i < count; i += 1) {
        sequence += 1;
        rows.push({
          offeringId,
          sequence,
          datetime: new Date(start.getTime() + i * intervalDays * 86_400_000),
          location,
        });
      }
      await prisma.educationSession.createMany({ data: rows });
      await logAuditEvent({
        action: "education.session.create",
        userId: actorId,
        targetId: offeringId,
        metadata: { offeringId, count, intervalDays, bulk: true },
      });
      return { ok: true };
    }

    case "update-session": {
      const sessionId = String(formData.get("sessionId") ?? "");
      const session = await prisma.educationSession.findUnique({
        where: { id: sessionId },
        select: { offeringId: true },
      });
      if (!session || session.offeringId !== offeringId)
        return bad("Session not found", 404);
      const datetime = parseDate(formData.get("datetime"));
      if (!datetime) return bad("Session date/time is required");
      await prisma.educationSession.update({
        where: { id: sessionId },
        data: {
          title: String(formData.get("title") ?? "").trim() || null,
          datetime,
          location: String(formData.get("location") ?? "").trim() || null,
          notes: String(formData.get("notes") ?? "").trim() || null,
          recordingUrl: String(formData.get("recordingUrl") ?? "").trim() || null,
        },
      });
      await logAuditEvent({
        action: "education.session.update",
        userId: actorId,
        targetId: sessionId,
        metadata: { offeringId },
      });
      return { ok: true, id: sessionId };
    }

    case "delete-session": {
      const sessionId = String(formData.get("sessionId") ?? "");
      const session = await prisma.educationSession.findUnique({
        where: { id: sessionId },
        select: { offeringId: true, _count: { select: { attendances: true } } },
      });
      if (!session || session.offeringId !== offeringId)
        return bad("Session not found", 404);
      if (session._count.attendances > 0)
        return bad("This session has attendance records and can't be deleted");
      await prisma.educationSession.delete({ where: { id: sessionId } });
      await logAuditEvent({
        action: "education.session.delete",
        userId: actorId,
        targetId: sessionId,
        metadata: { offeringId },
      });
      return { ok: true };
    }

    case "set-decision-email": {
      const status = formData.get("status");
      if (status !== "Approved" && status !== "Waitlisted" && status !== "Rejected")
        return bad("Invalid decision-email status");
      const versionId = String(formData.get("emailTemplateVersionId") ?? "");
      if (!versionId) {
        await prisma.educationDecisionEmail.deleteMany({
          where: { offeringId, status },
        });
      } else {
        const version = await prisma.emailTemplateVersion.findUnique({
          where: { id: versionId },
          select: { id: true },
        });
        if (!version) return bad("Email template version not found", 404);
        await prisma.educationDecisionEmail.upsert({
          where: { offeringId_status: { offeringId, status } },
          create: { offeringId, status, emailTemplateVersionId: versionId },
          update: { emailTemplateVersionId: versionId },
        });
      }
      await logAuditEvent({
        action: "education.decision-email.bind",
        userId: actorId,
        targetId: offeringId,
        metadata: { status, emailTemplateVersionId: versionId || null },
      });
      return { ok: true, id: offeringId };
    }

    case "set-instructors": {
      if (!(await isCore(actorId))) return bad("Core only", 403);
      // One repeated field per selected instructor (checkbox-native).
      const userIds = formData
        .getAll("userIds")
        .map((v) => String(v))
        .filter(Boolean);
      const term = await currentTerm();
      if (!term) return bad("No current term configured", 500);
      const priorInstructorIds = new Set(
        (
          await prisma.instructorAssignment.findMany({
            where: { offeringId },
            select: { userId: true },
          })
        ).map((i) => i.userId),
      );
      // Only member instructors are managed by this picker — external
      // (non-DALI) instructors are added/removed via the dedicated intents
      // below, so the destructive replace must not sweep them out.
      await prisma.$transaction([
        prisma.instructorAssignment.deleteMany({
          where: { offeringId, user: { daliMember: { isNot: null } } },
        }),
        prisma.instructorAssignment.createMany({
          data: userIds.map((userId) => ({ userId, offeringId, termId: term.id })),
          skipDuplicates: true,
        }),
      ]);
      await logAuditEvent({
        action: "education.instructors.set",
        userId: actorId,
        targetId: offeringId,
        metadata: { userIds },
      });
      // Becoming an instructor is a pay-affecting promotion — tell admins about
      // newly-added instructors (issue #1001). Removals are intentionally silent.
      for (const userId of userIds) {
        if (priorInstructorIds.has(userId)) continue;
        void notifyAdminsOfPromotion({
          userId,
          actorId,
          summary: `was made an instructor for ${offering.title}`,
        }).catch((err) => console.error("promotion notify (instructor) failed", err));
      }
      return { ok: true, id: offeringId };
    }

    case "invite-external-instructor": {
      // Core-only: bring a non-DALI Dartmouth person in as an instructor for
      // this offering. Provisions a shell User keyed on NetID (converges with
      // any existing applicant/student row), assigns them for the current term,
      // and emails an invite. They authenticate with Dartmouth SSO — no dali
      // email is issued.
      if (!(await isCore(actorId))) return bad("Core only", 403);
      const netId = String(formData.get("netId") ?? "").trim().toLowerCase();
      const firstName = String(formData.get("firstName") ?? "").trim();
      const lastName = String(formData.get("lastName") ?? "").trim();
      if (!netId) return bad("NetID is required");
      if (!firstName || !lastName) return bad("First and last name are required");
      const term = await currentTerm();
      if (!term) return bad("No current term configured", 500);

      // Verify a real Dartmouth account exists before creating a shell user.
      // peopleByNetId returns null on 404 and throws on transport errors.
      const person = await peopleByNetId(netId).catch(() => undefined);
      if (person === undefined)
        return bad("Couldn't reach the Dartmouth directory — try again", 502);
      if (person === null)
        return bad(`No Dartmouth account found for NetID "${netId}"`, 404);

      // Upsert by netId: whether they applied first or are invited first, it's
      // one account. CAS overwrites the name from the authoritative claim on
      // first login.
      const user = await prisma.user.upsert({
        where: { netId },
        update: {},
        create: {
          netId,
          firstName,
          lastName,
          dartmouthEmail: `${netId}@dartmouth.edu`,
        },
        select: { id: true, firstName: true, dartmouthEmail: true, netId: true },
      });

      const already = await prisma.instructorAssignment.findFirst({
        where: { userId: user.id, offeringId, termId: term.id },
        select: { id: true },
      });
      if (already) return { ok: true, id: offeringId };

      await prisma.instructorAssignment.create({
        data: { userId: user.id, offeringId, termId: term.id },
      });
      await logAuditEvent({
        action: "education.instructors.invite",
        userId: actorId,
        targetId: offeringId,
        metadata: { userId: user.id, netId },
      });
      // Instructor = pay-affecting promotion (mirrors set-instructors).
      void notifyAdminsOfPromotion({
        userId: user.id,
        actorId,
        summary: `was invited as an external instructor for ${offering.title}`,
      }).catch((err) =>
        console.error("promotion notify (external instructor) failed", err),
      );
      void notifyExternalInstructorInvite({
        user,
        offeringId,
        offeringTitle: offering.title,
      }).catch((err) =>
        console.error("external instructor invite email failed", err),
      );
      return { ok: true, id: offeringId };
    }

    case "remove-external-instructor": {
      if (!(await isCore(actorId))) return bad("Core only", 403);
      const userId = String(formData.get("userId") ?? "");
      if (!userId) return bad("userId is required");
      await prisma.instructorAssignment.deleteMany({
        where: { offeringId, userId },
      });
      await logAuditEvent({
        action: "education.instructors.removeExternal",
        userId: actorId,
        targetId: offeringId,
        metadata: { userId },
      });
      return { ok: true, id: offeringId };
    }
  }

  return bad("Unknown intent");
}
