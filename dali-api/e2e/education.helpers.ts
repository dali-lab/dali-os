import pg from 'pg';
import { randomBytes } from 'node:crypto';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

export const ADMIN_EMAIL = 'admin@dali.dartmouth.edu';
export const STUDENT = { daliEmail: 'noor.haddad@dali.dartmouth.edu', name: 'Noor Haddad' };
export const OUTSIDER = { daliEmail: 'marcus.bell@dali.dartmouth.edu', name: 'Marcus Bell' };

export const uid = () => randomBytes(3).toString('hex');

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function userId(c: pg.Client, daliEmail: string): Promise<string> {
  const { rows } = await c.query('SELECT id FROM "User" WHERE "daliEmail" = $1', [daliEmail]);
  if (!rows[0]) throw new Error(`seeded user ${daliEmail} not found`);
  return rows[0].id;
}

/** A Published miniseries with an open registration window (relative to now),
 *  plus one Approved enrollment for `studentEmail` and the admin as instructor. */
export async function createCourse(opts: { id: string; title: string; studentEmail: string }) {
  await withClient(async (c) => {
    const day = 86_400_000;
    const now = Date.now();
    await c.query(
      `INSERT INTO "EducationOffering"
         (id, type, title, capacity, "registrationOpensAt", "registrationClosesAt",
          "startsAt", "endsAt", status, "requiresReview", "completionThreshold", "createdAt")
       VALUES ($1, 'Miniseries', $2, 10, $3, $4, $5, $6, 'Published', false, 0.8, now())`,
      [
        opts.id,
        opts.title,
        new Date(now - 30 * day),
        new Date(now + 30 * day),
        new Date(now + 31 * day),
        new Date(now + 60 * day),
      ],
    );
    const student = await userId(c, opts.studentEmail);
    await c.query(
      `INSERT INTO "EducationApplication" (id, "applicantUserId", "offeringId", status, "submittedAt")
       VALUES ($1, $2, $3, 'Approved', now())`,
      [`${opts.id}-app`, student, opts.id],
    );
    const admin = await userId(c, ADMIN_EMAIL);
    await c.query(
      `INSERT INTO "InstructorAssignment" (id, "userId", "offeringId", "termId")
       VALUES ($1, $2, $3, (SELECT id FROM "Term" ORDER BY id LIMIT 1))`,
      [`${opts.id}-instr`, admin, opts.id],
    );
  });
}

/** An assignment inserted directly (the UI path is covered by the instructor test). */
export async function createAssignmentRow(opts: {
  id: string;
  offeringId: string;
  title: string;
  type: 'Text' | 'Link' | 'Mixed' | 'Complete';
  dueAt: Date | null;
}) {
  await withClient((c) =>
    c.query(
      `INSERT INTO "EducationAssignment" (id, "offeringId", title, "submissionType", "dueAt")
       VALUES ($1, $2, $3, $4::"SubmissionType", $5)`,
      [opts.id, opts.offeringId, opts.title, opts.type, opts.dueAt],
    ),
  );
}

export type SubmissionRow = {
  textContent: string | null;
  link: string | null;
  submittedAt: Date | null;
  gradedAt: Date | null;
  grade: string | null;
  score: number | null;
};

export async function getSubmission(
  offeringId: string,
  assignmentTitle: string,
  studentEmail: string,
): Promise<SubmissionRow | null> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT s."textContent", s.link, s."submittedAt", s."gradedAt", s.grade, s.score
         FROM "EducationSubmission" s
         JOIN "EducationAssignment" a ON a.id = s."assignmentId"
         JOIN "User" u ON u.id = s."studentId"
        WHERE a."offeringId" = $1 AND a.title = $2 AND u."daliEmail" = $3`,
      [offeringId, assignmentTitle, studentEmail],
    );
    return rows[0] ?? null;
  });
}

export async function assignmentIdByTitle(offeringId: string, title: string): Promise<string | null> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      'SELECT id FROM "EducationAssignment" WHERE "offeringId" = $1 AND title = $2',
      [offeringId, title],
    );
    return rows[0]?.id ?? null;
  });
}

export async function deleteCourse(offeringId: string) {
  await withClient(async (c) => {
    const q = (sql: string) => c.query(sql, [offeringId]);
    await q(`DELETE FROM "EducationSubmission" WHERE "assignmentId" IN
             (SELECT id FROM "EducationAssignment" WHERE "offeringId" = $1)`);
    await q('DELETE FROM "EducationAssignment" WHERE "offeringId" = $1');
    await q('DELETE FROM "EducationDiscussionPost" WHERE "offeringId" = $1');
    await q('DELETE FROM "EducationAnnouncement" WHERE "offeringId" = $1');
    await q('DELETE FROM "EducationApplication" WHERE "offeringId" = $1');
    await q('DELETE FROM "InstructorAssignment" WHERE "offeringId" = $1');
    await q('DELETE FROM "EducationOffering" WHERE id = $1');
  });
}

/** Drop a member's progress on one journey so the learner test starts fresh. */
export async function resetJourneyProgress(journeyId: string, daliEmail: string) {
  await withClient((c) =>
    c.query(
      `DELETE FROM "OnboardingJourneyProgress"
        WHERE "journeyId" = $1 AND "userId" = (SELECT id FROM "User" WHERE "daliEmail" = $2)`,
      [journeyId, daliEmail],
    ),
  );
}
