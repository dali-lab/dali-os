import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

export const PROJECT_ID = 'project-thayer-lab';

// Placeholder identities from the seed. Mira and Theo are staffed elsewhere
// and are added to PROJECT_ID by addMembers; Isabela is staffed on a different
// project and never added here, so she is the outsider.
export const MEMBER_A = { email: 'eng.lead@dali.dartmouth.edu', name: 'Mira Chen' };
export const MEMBER_B = { email: 'pm.lead@dali.dartmouth.edu', name: 'Theo Abernathy' };
export const OUTSIDER = { email: 'design.lead@dali.dartmouth.edu', name: 'Isabela Ferreira' };

export const stamp = () => Math.random().toString(36).slice(2, 8);

/** Today as yyyy-MM-dd in the local zone, the format the date picker's day cells carry. */
export function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Staff the given users on PROJECT_ID in the seeded 26S term. Returns the
 *  assignment ids so removeMembers deletes exactly the rows this run added. */
export async function addMembers(emails: string[]): Promise<string[]> {
  return withDb(async (c) => {
    const term = await c.query(`SELECT id FROM "Term" WHERE code = '26S'`);
    const domain = await c.query(`SELECT id FROM "Domain" ORDER BY id LIMIT 1`);
    const ids: string[] = [];
    for (const email of emails) {
      const id = `e2e-pa-${stamp()}${stamp()}`;
      await c.query(
        `INSERT INTO "ProjectAssignment" (id, "userId", "projectId", "termId", "domainId", level)
         SELECT $1, u.id, $2, $3, $4, 'P1' FROM "User" u WHERE u."daliEmail" = $5`,
        [id, PROJECT_ID, term.rows[0].id, domain.rows[0].id, email],
      );
      ids.push(id);
    }
    return ids;
  });
}

export async function removeMembers(ids: string[]) {
  await withDb((c) => c.query(`DELETE FROM "ProjectAssignment" WHERE id = ANY($1)`, [ids]));
}

/** Delete every epic, story and task on PROJECT_ID whose title carries `tag`. */
export async function cleanupTagged(tag: string) {
  await withDb(async (c) => {
    const like = `%${tag}%`;
    const tasks = `(SELECT id FROM "Task" WHERE "projectId" = $1 AND title LIKE $2)`;
    await c.query(`DELETE FROM "TaskComment" WHERE "taskId" IN ${tasks}`, [PROJECT_ID, like]);
    await c.query(`DELETE FROM "TaskAssignee" WHERE "taskId" IN ${tasks}`, [PROJECT_ID, like]);
    await c.query(`DELETE FROM "TaskStatusChange" WHERE "taskId" IN ${tasks}`, [PROJECT_ID, like]);
    await c.query(`DELETE FROM "Task" WHERE "projectId" = $1 AND title LIKE $2`, [PROJECT_ID, like]);
    await c.query(
      `DELETE FROM "UserStory" WHERE title LIKE $2 AND "epicId" IN (SELECT id FROM "Epic" WHERE "projectId" = $1)`,
      [PROJECT_ID, like],
    );
    await c.query(`DELETE FROM "Epic" WHERE "projectId" = $1 AND title LIKE $2`, [PROJECT_ID, like]);
  });
}

/** Rows the page-level assertions check against, read straight from Postgres. */
export async function taskRow(title: string) {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT t.id, t.status, t."dueAt", t."storyId", t."epicId", s.title AS "storyTitle", e.title AS "epicTitle"
       FROM "Task" t
       LEFT JOIN "UserStory" s ON s.id = t."storyId"
       LEFT JOIN "Epic" e ON e.id = t."epicId"
       WHERE t."projectId" = $1 AND t.title = $2`,
      [PROJECT_ID, title],
    );
    return r.rows as {
      id: string;
      status: string;
      dueAt: Date | null;
      storyId: string | null;
      epicId: string | null;
      storyTitle: string | null;
      epicTitle: string | null;
    }[];
  });
}
