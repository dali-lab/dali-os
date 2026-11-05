import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const randomSuffix = () => Math.random().toString(36).slice(2, 8);

export async function userIdByEmail(daliEmail: string): Promise<string> {
  return withClient(async (c) => {
    const { rows } = await c.query(`SELECT id FROM "User" WHERE "daliEmail" = $1`, [daliEmail]);
    if (!rows[0]) throw new Error(`No seeded user ${daliEmail}`);
    return rows[0].id as string;
  });
}

const PROFILE_COLUMNS = ['pronouns', 'major', 'hometown'] as const;
export type ProfileSnapshot = Record<(typeof PROFILE_COLUMNS)[number], string | null>;

export async function snapshotProfile(userId: string): Promise<ProfileSnapshot> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT pronouns, major, hometown FROM "User" WHERE id = $1`,
      [userId],
    );
    return rows[0] as ProfileSnapshot;
  });
}

export async function restoreProfile(userId: string, snap: ProfileSnapshot) {
  await withClient((c) =>
    c.query(`UPDATE "User" SET pronouns = $2, major = $3, hometown = $4 WHERE id = $1`, [
      userId,
      snap.pronouns,
      snap.major,
      snap.hometown,
    ]),
  );
}

export async function readProfile(userId: string): Promise<ProfileSnapshot> {
  return snapshotProfile(userId);
}

export async function findGroup(name: string): Promise<{ id: string; staticMemberIds: string[] } | null> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT id, "staticMemberIds" FROM "GroupDefinition" WHERE name = $1`,
      [name],
    );
    return rows[0] ?? null;
  });
}

export async function deleteGroupsNamed(name: string) {
  await withClient((c) => c.query(`DELETE FROM "GroupDefinition" WHERE name = $1`, [name]));
}

/** Remove a mentor note the spec created, plus the notebook tab page it spawned. */
export async function deleteMentorNote(noteId: string) {
  await withClient(async (c) => {
    const { rows } = await c.query(`SELECT "pageId" FROM "MentorNote" WHERE id = $1`, [noteId]);
    await c.query(`DELETE FROM "MentorNote" WHERE id = $1`, [noteId]);
    const pageId = rows[0]?.pageId as string | undefined;
    if (pageId) await c.query(`DELETE FROM "Page" WHERE id = $1`, [pageId]);
  });
}

export async function readMentorNote(noteId: string): Promise<{ vibe: string | null; mentorId: string } | null> {
  return withClient(async (c) => {
    const { rows } = await c.query(`SELECT vibe, "mentorId" FROM "MentorNote" WHERE id = $1`, [noteId]);
    return rows[0] ?? null;
  });
}
