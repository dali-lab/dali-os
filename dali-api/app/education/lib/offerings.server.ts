import { prisma } from "~/lib/db";
import { currentTerm, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { notifyAdminsOfPromotion } from "~/lib/promotion-notify.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { manageableOfferingIds, isOfferingManager } from "./access.server";
import { createOfferingApplicationForm } from "./application-form.server";
import { ensureOfferingDriveFolder } from "~/lib/pages";
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
  term: { select: { code: true } },
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
    orderBy: { startsAt: { sort: "asc", nulls: "last" } },
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
      term: { select: { code: true } },
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
  const { term, ...rest } = offering;
  return {
    ...rest,
    termCode: term?.code ?? null,
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
  startsAt: Date | null;
  endsAt: Date | null;
  closedOutAt: Date | null;
  instructors: {
    userId: string;
    user: { firstName: string; lastName: string; photoUrl: string | null };
  }[];
  sessions: { id: string; datetime: Date }[];
  term: { code: string } | null;
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
    termCode: o.term?.code ?? null,
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

function validateRegistrationWindow(o: {
  registrationOpensAt: Date;
  registrationClosesAt: Date;
}): string | null {
  if (o.registrationOpensAt >= o.registrationClosesAt)
    return "Registration must open before it closes";
  return null;
}

/**
 * The term an offering belongs to, derived from its start date: the term whose
 * date window contains it. Null when the date falls outside every seeded term.
 * Mirrors the backfill in the education-offering-term migration, so create/
 * update stay consistent with the one-time backfill.
 */
async function termIdForDate(date: Date): Promise<string | null> {
  const term = await prisma.term.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date } },
    orderBy: { sortKey: "desc" },
    select: { id: true },
  });
  return term?.id ?? null;
}

/**
 * Recompute startsAt, endsAt, and termId from the offering's sessions.
 * Called after every session add/update/delete so the catalog dates stay
 * in sync with what instructors actually scheduled.
 * Zero sessions → all three set to null (offering is a draft stub).
 */
export async function recomputeOfferingDates(offeringId: string): Promise<void> {
  const sessions = await prisma.educationSession.findMany({
    where: { offeringId },
    orderBy: { datetime: "asc" },
    select: { datetime: true },
  });
  if (sessions.length === 0) {
    await prisma.educationOffering.update({
      where: { id: offeringId },
      data: { startsAt: null, endsAt: null, termId: null },
    });
    return;
  }
  const startsAt = sessions[0].datetime;
  const endsAt = sessions[sessions.length - 1].datetime;
  await prisma.educationOffering.update({
    where: { id: offeringId },
    data: { startsAt, endsAt, termId: await termIdForDate(startsAt) },
  });
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
    };
    if (!dates.registrationOpensAt || !dates.registrationClosesAt)
      return bad("Registration dates are required");
    const dateError = validateRegistrationWindow(
      dates as { registrationOpensAt: Date; registrationClosesAt: Date },
    );
    if (dateError) return bad(dateError);

    const createThresholdPct = Number(formData.get("completionThresholdPct"));
    const createCompletionThreshold =
      type === "Miniseries" && Number.isFinite(createThresholdPct) && createThresholdPct > 0
        ? Math.min(100, Math.max(1, createThresholdPct)) / 100
        : undefined;

    const offering = await prisma.educationOffering.create({
      data: {
        type,
        title,
        capacity,
        registrationOpensAt: dates.registrationOpensAt,
        registrationClosesAt: dates.registrationClosesAt,
        // Checkbox is authoritative: absent (unchecked) = RSVP auto-approve.
        requiresReview: formData.get("requiresReview") === "true",
        status: "Draft",
        ...(createCompletionThreshold !== undefined
          ? { completionThreshold: createCompletionThreshold }
          : {}),
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
    // Auto-provision a Drive folder for uploaded file materials. Best-effort:
    // a failure here doesn't block offering creation — it self-heals on the
    // next Drive visit or file upload.
    await ensureOfferingDriveFolder(offering.id, actorId).catch((err) =>
      console.error("ensureOfferingDriveFolder failed on create", err),
    );
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
          completionThreshold: true,
          registrationOpensAt: true,
          registrationClosesAt: true,
          sessions: {
            orderBy: { sequence: "asc" },
            select: { sequence: true, title: true, datetime: true, location: true },
          },
          instructors: { select: { userId: true } },
        },
      });
      if (!src) return bad("Offering not found", 404);

      // Compute the time delta to shift all sessions and registration dates.
      // The caller supplies a new datetime for the first session; we preserve
      // the spacing between all sessions and between registration window + first
      // session. If the source has no sessions, we copy dates as-is.
      const firstSessionDateRaw = formData.get("firstSessionDate");
      const newFirstSession =
        typeof firstSessionDateRaw === "string" && firstSessionDateRaw
          ? new Date(firstSessionDateRaw)
          : null;

      const oldFirstSession =
        src.sessions.length > 0 ? src.sessions[0].datetime : null;

      // deltaMs > 0 means the clone is shifted into the future; null means no shift.
      const deltaMs =
        newFirstSession && oldFirstSession && !Number.isNaN(newFirstSession.getTime())
          ? newFirstSession.getTime() - oldFirstSession.getTime()
          : null;

      const shiftDate = (d: Date) =>
        deltaMs !== null ? new Date(d.getTime() + deltaMs) : d;

      const created = await prisma.educationOffering.create({
        data: {
          type: src.type,
          title: `${src.title} (copy)`,
          capacity: src.capacity,
          requiresReview: src.requiresReview,
          calendarEmail: src.calendarEmail,
          completionThreshold: src.completionThreshold,
          registrationOpensAt: shiftDate(src.registrationOpensAt),
          registrationClosesAt: shiftDate(src.registrationClosesAt),
          status: "Draft",
          sessions: {
            create: src.sessions.map((s) => ({
              sequence: s.sequence,
              title: s.title,
              datetime: shiftDate(s.datetime),
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
      await recomputeOfferingDates(created.id);
      // Best-effort Drive folder for the clone (same as fresh create).
      await ensureOfferingDriveFolder(created.id, actorId).catch((err) =>
        console.error("ensureOfferingDriveFolder failed on duplicate", err),
      );
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
      if (!registrationOpensAt || !registrationClosesAt)
        return bad("Registration dates are required");
      const dateError = validateRegistrationWindow({
        registrationOpensAt,
        registrationClosesAt,
      });
      if (dateError) return bad(dateError);

      // Parse completion threshold for Miniseries only; Workshops use a fixed
      // "≥1 Present" rule so the threshold column is irrelevant for them.
      const thresholdPct = Number(formData.get("completionThresholdPct"));
      const completionThreshold =
        offering.type === "Miniseries" && Number.isFinite(thresholdPct)
          ? Math.min(100, Math.max(1, thresholdPct)) / 100
          : undefined;

      await prisma.educationOffering.update({
        where: { id: offeringId },
        data: {
          title,
          capacity,
          registrationOpensAt,
          registrationClosesAt,
          requiresReview: formData.get("requiresReview") === "true",
          calendarEmail: String(formData.get("calendarEmail") ?? "").trim() || null,
          ...(completionThreshold !== undefined ? { completionThreshold } : {}),
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
        if (offering.sessions.length === 0)
          return bad("Add at least one session before publishing");
        await recomputeOfferingDates(offeringId);
        const regError = validateRegistrationWindow(offering);
        if (regError) return bad(`Fix before publishing: ${regError.toLowerCase()}`);
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
      await recomputeOfferingDates(offeringId);
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
      await recomputeOfferingDates(offeringId);
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
      await recomputeOfferingDates(offeringId);
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
      await recomputeOfferingDates(offeringId);
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
      await prisma.$transaction([
        prisma.instructorAssignment.deleteMany({ where: { offeringId } }),
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
  }

  return bad("Unknown intent");
}
