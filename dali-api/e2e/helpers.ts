import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

// ── Drive-consolidation flag helpers ──────────────────────────────────────────
//
// These scope the flag to a single user's User.id, not everyone=true, so
// parallel Playwright workers don't leak Drive nav into other specs.

/**
 * Upsert the `drive-consolidation` FeatureFlag row targeting only the user
 * identified by `daliEmail`. Does not set everyone=true so other specs and
 * other DB-sharing test workers are unaffected.
 */
export async function enableDriveFlagForUser(daliEmail: string) {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    // Resolve the User.id for this daliEmail first.
    const userRow = await client.query<{ id: string }>(
      `SELECT id FROM "User" WHERE "daliEmail" = $1`,
      [daliEmail],
    );
    if (userRow.rowCount === 0) {
      throw new Error(`enableDriveFlagForUser: no User found for daliEmail=${daliEmail}`);
    }
    const userId = userRow.rows[0].id;

    // Upsert the flag: enabled=true, everyone=false, userIds=[userId].
    // ARRAY[$1::text] produces a Postgres text[] literal from a JS string.
    await client.query(
      `INSERT INTO "FeatureFlag" (key, enabled, everyone, roles, "userIds", "updatedAt")
       VALUES ('drive-consolidation', true, false, '{}', ARRAY[$1::text], NOW())
       ON CONFLICT (key) DO UPDATE
         SET enabled = true,
             everyone = false,
             roles = '{}',
             "userIds" = ARRAY[$1::text],
             "updatedAt" = NOW()`,
      [userId],
    );
  } finally {
    await client.end();
  }
}

/**
 * Remove the `drive-consolidation` FeatureFlag row entirely so the flag
 * reverts to its registry default (off). Called in afterAll to clean up.
 */
export async function clearDriveFlag() {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    await client.query(`DELETE FROM "FeatureFlag" WHERE key = 'drive-consolidation'`);
  } finally {
    await client.end();
  }
}

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
