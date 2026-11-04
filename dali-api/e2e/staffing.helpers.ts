import { randomUUID } from 'node:crypto';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

export type StaffingFixture = {
  suffix: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  projectId: string;
  projectName: string;
  cycleId: string;
  termId: string;
  domainId: string;
};

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** A throwaway project (running this term) plus one member who bid on it, so
 *  the member lands on the board's Unassigned column. Placeholder identity. */
export async function createStaffingFixture(): Promise<StaffingFixture> {
  const suffix = randomUUID().slice(0, 6);
  const f: StaffingFixture = {
    suffix,
    userId: `e2e-stf-u-${suffix}`,
    email: `ada.${suffix}@example.edu`,
    firstName: 'Ada',
    lastName: `Lovelace${suffix}`,
    fullName: `Ada Lovelace${suffix}`,
    projectId: `e2e-stf-p-${suffix}`,
    projectName: `Analytical Engine ${suffix}`,
    cycleId: '',
    termId: '',
    domainId: 'domain-eng',
  };
  await withClient(async (c) => {
    // The board shows the term bracketing now(); the seed anchors 26S there.
    const { rows } = await c.query(
      `SELECT t.id AS "termId", sc.id AS "cycleId" FROM "Term" t
       JOIN "StaffingCycle" sc ON sc."termId" = t.id
       WHERE t."startDate" <= now() AND t."endDate" >= now()
       ORDER BY t."startDate" DESC LIMIT 1`,
    );
    f.termId = rows[0].termId;
    f.cycleId = rows[0].cycleId;
    await c.query(
      `INSERT INTO "User" (id, "updatedAt", "firstName", "lastName", name, "daliEmail", handle)
       VALUES ($1, now(), $2, $3, $4, $5, $6)`,
      [f.userId, f.firstName, f.lastName, f.fullName, f.email, `ada-${suffix}`],
    );
    await c.query(
      `INSERT INTO "DALIMember" (id, "updatedAt", "userId") VALUES ($1, now(), $2)`,
      [`e2e-stf-m-${suffix}`, f.userId],
    );
    await c.query(`INSERT INTO "Project" (id, name) VALUES ($1, $2)`, [f.projectId, f.projectName]);
    await c.query(`INSERT INTO "ProjectTerm" ("projectId", "termId") VALUES ($1, $2)`, [
      f.projectId,
      f.termId,
    ]);
    await c.query(
      `INSERT INTO "StaffingPreference"
         (id, "userId", "staffingCycleId", "projectId", "domainId", level, "preferenceRank")
       VALUES ($1, $2, $3, $4, $5, 'P1', 1)`,
      [`e2e-stf-pref-${suffix}`, f.userId, f.cycleId, f.projectId, f.domainId],
    );
  });
  return f;
}

export async function deleteStaffingFixture(f: StaffingFixture) {
  await withClient(async (c) => {
    const byProject = [f.projectId];
    const byUser = [f.userId];
    await c.query(`DELETE FROM "StaffingAssignment" WHERE "projectId" = $1`, byProject);
    await c.query(`DELETE FROM "StaffingPreference" WHERE "projectId" = $1`, byProject);
    await c.query(`DELETE FROM "MentorshipPair" WHERE "projectId" = $1`, byProject);
    await c.query(`DELETE FROM "Notification" WHERE "recipientUserId" = $1`, byUser);
    await c.query(`DELETE FROM "StaffingCardOrder" WHERE "userId" = $1`, byUser);
    await c.query(`DELETE FROM "ProjectAssignment" WHERE "projectId" = $1`, byProject);
    await c.query(`DELETE FROM "DomainEligibility" WHERE "userId" = $1`, byUser);
    await c.query(`DELETE FROM "ProjectTerm" WHERE "projectId" = $1`, byProject);
    await c.query(`DELETE FROM "Project" WHERE id = $1`, byProject);
    await c.query(`DELETE FROM "DALIMember" WHERE "userId" = $1`, byUser);
    await c.query(`DELETE FROM "User" WHERE id = $1`, byUser);
  });
}

export async function projectAssignmentCount(f: StaffingFixture): Promise<number> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM "ProjectAssignment" WHERE "projectId" = $1 AND "userId" = $2`,
      [f.projectId, f.userId],
    );
    return rows[0].n;
  });
}
