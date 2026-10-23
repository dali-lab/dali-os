import { test, expect } from '@playwright/test';
import pg from 'pg';

// The Task_status_change trigger (migration task_status_change) is plain SQL,
// so it's exercised against the real Postgres rather than through Vitest mocks.

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

test.describe('TaskStatusChange trigger', () => {
  let client: pg.Client;
  let taskId: string;
  let projectId: string;
  let original: string;

  test.beforeEach(async () => {
    client = new pg.Client(DATABASE_URL);
    await client.connect();
    const { rows } = await client.query(
      `SELECT id, "projectId", status FROM "Task" WHERE status = 'Todo' ORDER BY id LIMIT 1`,
    );
    expect(rows, 'seed should include a Todo task').toHaveLength(1);
    ({ id: taskId, projectId, status: original } = rows[0]);
  });

  test.afterEach(async () => {
    await client.query(`UPDATE "Task" SET status = $2 WHERE id = $1`, [taskId, original]);
    await client.query(`DELETE FROM "TaskStatusChange" WHERE "taskId" = $1`, [taskId]);
    await client.end();
  });

  const history = async () =>
    (
      await client.query(
        `SELECT "fromStatus", "toStatus", "projectId", "changedAt" FROM "TaskStatusChange"
         WHERE "taskId" = $1 ORDER BY "changedAt"`,
        [taskId],
      )
    ).rows;

  test('edits that keep the status record nothing', async () => {
    await client.query(`UPDATE "Task" SET title = title, "activityAt" = now() WHERE id = $1`, [taskId]);
    await client.query(`UPDATE "Task" SET status = status WHERE id = $1`, [taskId]);
    expect(await history()).toEqual([]);
  });

  test('every move is recorded, including a move back', async () => {
    for (const status of ['InProgress', 'Done', 'InProgress']) {
      await client.query(`UPDATE "Task" SET status = $2 WHERE id = $1`, [taskId, status]);
    }
    const rows = await history();
    expect(rows.map((r) => [r.fromStatus, r.toStatus])).toEqual([
      ['Todo', 'InProgress'],
      ['InProgress', 'Done'],
      ['Done', 'InProgress'],
    ]);
    expect(rows.every((r) => r.projectId === projectId)).toBe(true);
  });

  test('a rolled-back move records nothing', async () => {
    await client.query('BEGIN');
    await client.query(`UPDATE "Task" SET status = 'Done' WHERE id = $1`, [taskId]);
    await client.query('ROLLBACK');
    expect(await history()).toEqual([]);
  });

  test('changedAt is UTC whatever the session time zone', async () => {
    await client.query(`SET TIME ZONE 'America/New_York'`);
    await client.query(`UPDATE "Task" SET status = 'Done' WHERE id = $1`, [taskId]);
    const {
      rows: [{ drift }],
    } = await client.query(
      `SELECT abs(extract(epoch FROM ("changedAt" - (now() AT TIME ZONE 'UTC')))) AS drift
       FROM "TaskStatusChange" WHERE "taskId" = $1`,
      [taskId],
    );
    await client.query('RESET TIME ZONE');
    expect(Number(drift)).toBeLessThan(60);
  });
});
