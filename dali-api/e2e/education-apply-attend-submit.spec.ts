import { test, expect } from "./fixtures";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://dali:dali@localhost:5432/dali";

const OFFERING_TITLE = "E2E Test Miniseries";

// Insert a published EducationOffering with one session + question; clean up
// after. Uses the admin seed user (admin@dali.dartmouth.edu) as the
// instructor — already a Core member from the local seed.
async function seedOffering(): Promise<{
  offeringId: string;
  sessionId: string;
  questionId: string;
  termId: string;
  adminId: string;
}> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    const admin = await client.query<{ id: string }>(
      `SELECT id FROM "User" WHERE "daliEmail" = 'admin@dali.dartmouth.edu' LIMIT 1`,
    );
    const adminId = admin.rows[0].id;
    const term = await client.query<{ id: string }>(
      `SELECT id FROM "Term" ORDER BY "sortKey" DESC LIMIT 1`,
    );
    const termId = term.rows[0].id;

    const now = new Date();
    const opens = new Date(now.getTime() - 60_000).toISOString();
    const closes = new Date(now.getTime() + 7 * 86_400_000).toISOString();
    const starts = new Date(now.getTime() + 86_400_000).toISOString();
    const ends = new Date(now.getTime() + 14 * 86_400_000).toISOString();

    const offering = await client.query<{ id: string }>(
      `INSERT INTO "EducationOffering"
       ("id","type","title","capacity","registrationOpensAt","registrationClosesAt","startsAt","endsAt","status","requiresReview","createdAt")
       VALUES (gen_random_uuid()::text, 'Miniseries', $1, 5, $2, $3, $4, $5, 'Published', true, NOW())
       RETURNING id`,
      [OFFERING_TITLE, opens, closes, starts, ends],
    );
    const offeringId = offering.rows[0].id;
    await client.query(
      `INSERT INTO "InstructorAssignment" ("id","userId","offeringId","termId") VALUES (gen_random_uuid()::text,$1,$2,$3)`,
      [adminId, offeringId, termId],
    );
    const session = await client.query<{ id: string }>(
      `INSERT INTO "EducationSession" ("id","offeringId","sequence","datetime")
       VALUES (gen_random_uuid()::text, $1, 1, $2) RETURNING id`,
      [offeringId, starts],
    );
    const sessionId = session.rows[0].id;
    const question = await client.query<{ id: string }>(
      `INSERT INTO "EducationApplicationQuestion" ("id","offeringId","prompt","position","required")
       VALUES (gen_random_uuid()::text, $1, 'Why do you want to take this?', 0, true)
       RETURNING id`,
      [offeringId],
    );
    return {
      offeringId,
      sessionId,
      questionId: question.rows[0].id,
      termId,
      adminId,
    };
  } finally {
    await client.end();
  }
}

async function cleanupOffering(offeringId: string) {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    await client.query(
      `DELETE FROM "EducationAttendance" WHERE "sessionId" IN (SELECT id FROM "EducationSession" WHERE "offeringId" = $1)`,
      [offeringId],
    );
    await client.query(
      `DELETE FROM "EducationApplicationAnswer" WHERE "applicationId" IN (SELECT id FROM "EducationApplication" WHERE "offeringId" = $1)`,
      [offeringId],
    );
    await client.query(
      `DELETE FROM "EducationApplication" WHERE "offeringId" = $1`,
      [offeringId],
    );
    await client.query(
      `DELETE FROM "EducationApplicationQuestion" WHERE "offeringId" = $1`,
      [offeringId],
    );
    await client.query(
      `DELETE FROM "EducationSession" WHERE "offeringId" = $1`,
      [offeringId],
    );
    await client.query(
      `DELETE FROM "InstructorAssignment" WHERE "offeringId" = $1`,
      [offeringId],
    );
    await client.query(
      `DELETE FROM "EducationOffering" WHERE id = $1`,
      [offeringId],
    );
  } finally {
    await client.end();
  }
}

test.describe("Education: apply → approve → attend happy path", () => {
  let ids: Awaited<ReturnType<typeof seedOffering>>;

  test.beforeAll(async () => {
    ids = await seedOffering();
  });
  test.afterAll(async () => {
    await cleanupOffering(ids.offeringId);
  });

  test("student applies, instructor approves, student sees Approved", async ({
    page,
    loginAs,
  }) => {
    // Student (any Dartmouth-authed user works — use the seeded carol applicant).
    await loginAs({ netId: "carolp" });
    await page.goto(`/portal/education/${ids.offeringId}`);
    await expect(page.getByRole("heading", { name: OFFERING_TITLE })).toBeVisible();

    await page
      .getByRole("textbox", { name: /Why do you want to take this/ })
      .fill("I want to learn.");
    await page.getByRole("button", { name: /Submit application/ }).click();

    await expect(page.getByText("Your status:")).toBeVisible();
    await expect(page.getByText("Submitted")).toBeVisible();

    // Instructor (admin) approves from the roster page.
    await loginAs({ daliEmail: "admin@dali.dartmouth.edu" });
    await page.goto(`/education/offerings/${ids.offeringId}/roster`);
    await expect(page.getByRole("heading", { name: OFFERING_TITLE })).toBeVisible();
    const approveButton = page
      .getByRole("button", { name: "Approve" })
      .first();
    await expect(approveButton).toBeVisible();
    await approveButton.click();

    // Student sees Approved.
    await loginAs({ netId: "carolp" });
    await page.goto("/education/my-learning");
    await expect(page.getByText(OFFERING_TITLE)).toBeVisible();
    await expect(page.getByText("Approved")).toBeVisible();
  });
});
