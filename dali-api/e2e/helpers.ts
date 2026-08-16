import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

/**
 * Delete any status updates beyond the seed baseline (Draft → Open) for
 * the given cycle. Used to revert cycle state after tests that advance it.
 */
export async function resetCycleStatus(cycleId: string) {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    // Keep only the two seed rows (Draft and Open); delete any test-added rows.
    await client.query(
      `DELETE FROM "ApplicationCycleStatusUpdate"
       WHERE "applicationCycleId" = $1
         AND "newStatus" NOT IN ('Draft', 'Open')`,
      [cycleId],
    );
  } finally {
    await client.end();
  }
}

/**
 * Remove education applications (plus their attendance rows and linked form
 * submissions) for one offering so the RSVP → waitlist → promotion spec
 * always starts from empty seats, regardless of what a prior run left.
 */
export async function resetEducationApplications(offeringId: string) {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    await client.query(
      `DELETE FROM "EducationAttendance"
       WHERE "applicationId" IN
         (SELECT id FROM "EducationApplication" WHERE "offeringId" = $1)`,
      [offeringId],
    );
    await client.query(
      `DELETE FROM "FormSubmission"
       WHERE id IN
         (SELECT "formSubmissionId" FROM "EducationApplication"
          WHERE "offeringId" = $1 AND "formSubmissionId" IS NOT NULL)`,
      [offeringId],
    );
    await client.query(
      `DELETE FROM "EducationApplication" WHERE "offeringId" = $1`,
      [offeringId],
    );
  } finally {
    await client.end();
  }
}
