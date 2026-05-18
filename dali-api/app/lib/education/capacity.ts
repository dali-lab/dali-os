import { prisma } from "~/lib/db";

// All Education capacity / waitlist queries live here so the decisions
// module can compose them inside a single transaction.

export async function approvedCount(
  offeringId: string,
  tx?: typeof prisma,
): Promise<number> {
  const client = tx ?? prisma;
  return client.educationApplication.count({
    where: { offeringId, status: "Approved" },
  });
}

export async function waitlistedCount(
  offeringId: string,
  tx?: typeof prisma,
): Promise<number> {
  const client = tx ?? prisma;
  return client.educationApplication.count({
    where: { offeringId, status: "Waitlisted" },
  });
}

/** First-in-waitlist by submittedAt (the earliest waitlisted application). */
export async function nextOnWaitlist(
  offeringId: string,
  tx?: typeof prisma,
): Promise<{ id: string; applicantUserId: string } | null> {
  const client = tx ?? prisma;
  return client.educationApplication.findFirst({
    where: { offeringId, status: "Waitlisted" },
    orderBy: { submittedAt: "asc" },
    select: { id: true, applicantUserId: true },
  });
}

/** Approved applicantUserIds for an offering — used by roster-sync. */
export async function approvedApplicantIds(
  offeringId: string,
  tx?: typeof prisma,
): Promise<string[]> {
  const client = tx ?? prisma;
  const rows = await client.educationApplication.findMany({
    where: { offeringId, status: "Approved" },
    select: { applicantUserId: true },
  });
  return rows.map((r) => r.applicantUserId);
}
