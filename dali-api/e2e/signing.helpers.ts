import pg from 'pg';
import { randomBytes } from 'node:crypto';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

export interface SigningFixture {
  suffix: string;
  documentId: string;
  documentName: string;
  bindingId: string;
  signer: { id: string; daliEmail: string; fullName: string };
  outsider: { id: string; daliEmail: string; fullName: string };
}

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function id(prefix: string) {
  return `${prefix}${randomBytes(8).toString('hex')}`;
}

/**
 * A published agreement with a "signer" test member in its audience and an
 * "outsider" member outside it.
 *
 * - 'fixed-group': app-gated, audience is a static group holding only the
 *   signer, so no seeded member is ever blocked by it.
 * - 'term-group': not app-gated (so seeded members are never blocked), audience
 *   is "active this term"; the signer gets a ProjectAssignment this term. The body has one required signature field.
 * All rows are uniquely suffixed so parallel specs and
 * reruns never collide.
 */
export async function createSigningFixture(
  opts: { mode: 'term-group' | 'fixed-group' } = { mode: 'term-group' },
): Promise<SigningFixture> {
  const suffix = randomBytes(3).toString('hex');
  return withClient(async (c) => {
    const mkUser = async (first: string, last: string) => {
      const userId = id('esu');
      const daliEmail = `${first.toLowerCase()}.${suffix}@example.edu`;
      await c.query(
        `INSERT INTO "User" (id, "updatedAt", "daliEmail", "firstName", "lastName", handle)
         VALUES ($1, now(), $2, $3, $4, $5)`,
        [userId, daliEmail, first, `${last}${suffix}`, `${first.toLowerCase()}${suffix}`],
      );
      await c.query(`INSERT INTO "DALIMember" (id, "updatedAt", "userId", "onboardedAt", "tourCompletedAt") VALUES ($1, now(), $2, now(), now())`, [id('esm'), userId]);
      return { id: userId, daliEmail, fullName: `${first} ${last}${suffix}` };
    };
    const signer = await mkUser('Ada', 'Lovelace');
    const outsider = await mkUser('Grace', 'Hopper');

    let groupId: string | null = null;
    if (opts.mode === 'fixed-group') {
      groupId = id('esg');
      await c.query(
        `INSERT INTO "GroupDefinition" (id, name, type, "staticMemberIds") VALUES ($1, $2, 'Static', $3)`,
        [groupId, `E2E signing group ${suffix}`, [signer.id]],
      );
    } else {
      const { rows: term } = await c.query(
        `SELECT id FROM "Term" WHERE "startDate" <= now() AND "endDate" >= now() ORDER BY "sortKey" DESC LIMIT 1`,
      );
      const { rows: pa } = await c.query(`SELECT "projectId", "domainId" FROM "ProjectAssignment" LIMIT 1`);
      await c.query(
        `INSERT INTO "ProjectAssignment" (id, "userId", "projectId", "termId", "domainId", level) VALUES ($1, $2, $3, $4, $5, 'P1')`,
        [id('esa'), signer.id, pa[0].projectId, term[0].id, pa[0].domainId],
      );
    }

    const { rows: admin } = await c.query(`SELECT id FROM "User" WHERE "daliEmail" = 'admin@dali.dartmouth.edu'`);
    const documentId = id('esd');
    const documentName = `E2E Lab Agreement ${suffix}`;
    await c.query(
      `INSERT INTO "SigningDocument" (id, "updatedAt", name, slug, "gateScope", audience, cadence, "audienceGroupId")
       VALUES ($1, now(), $2, $3, $5::"SigningGateScope", 'Group', 'Once', $4)`,
      [documentId, documentName, `e2e-signing-${suffix}`, groupId, opts.mode === 'fixed-group' ? 'App' : 'None'],
    );

    const body = [
      {
        id: `b1${suffix}`,
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: `I agree to the E2E terms ${suffix}.`, styles: {} }],
        children: [],
      },
      {
        id: `b2${suffix}`,
        type: 'paragraph',
        props: {},
        content: [
          { type: 'text', text: 'Sign: ', styles: {} },
          {
            type: 'signatureField',
            props: { fieldId: `sig-${suffix}`, role: 'member', label: 'Signature', placeholder: '', value: '', required: true },
          },
        ],
        children: [],
      },
    ];
    const versionId = id('esv');
    await c.query(
      `INSERT INTO "SigningDocumentVersion" (id, "versionNumber", body, roles, "publishedAt", "documentId", "createdById")
       VALUES ($1, 1, $2, '["member"]', now(), $3, $4)`,
      [versionId, JSON.stringify(body), documentId, admin[0].id],
    );
    const bindingId = id('esb');
    await c.query(
      `INSERT INTO "SigningBinding" (id, "updatedAt", "documentId", "versionId", "scopeKey") VALUES ($1, now(), $2, $3, 'app')`,
      [bindingId, documentId, versionId],
    );
    return { suffix, documentId, documentName, bindingId, signer, outsider };
  });
}

export async function countSignatures(bindingId: string, userId: string): Promise<number> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM "SigningSignature" WHERE "bindingId" = $1 AND "signerUserId" = $2`,
      [bindingId, userId],
    );
    return rows[0].n;
  });
}

export async function removeSigningFixture(f: SigningFixture) {
  await withClient(async (c) => {
    const ids = [f.signer.id, f.outsider.id];
    const run = async (sql: string, params: unknown[]) => {
      try {
        await c.query(sql, params);
      } catch {
        // best-effort cleanup; unique suffixes keep leftovers harmless
      }
    };
    await run(`DELETE FROM "ProjectAssignment" WHERE "userId" = ANY($1)`, [ids]);
    await run(`DELETE FROM "SigningSignature" WHERE "bindingId" = $1`, [f.bindingId]);
    await run(`DELETE FROM "SigningBinding" WHERE id = $1`, [f.bindingId]);
    await run(`DELETE FROM "SigningDocumentVersion" WHERE "documentId" = $1`, [f.documentId]);
    await run(`DELETE FROM "SigningDocument" WHERE id = $1`, [f.documentId]);
    await run(`DELETE FROM "GroupDefinition" WHERE name = $1`, [`E2E signing group ${f.suffix}`]);
    await run(`DELETE FROM "AuditLog" WHERE "userId" = ANY($1)`, [ids]);
    await run(`DELETE FROM "Notification" WHERE "userId" = ANY($1)`, [ids]);
    await run(`DELETE FROM "DALIMember" WHERE "userId" = ANY($1)`, [ids]);
    await run(`DELETE FROM "User" WHERE id = ANY($1)`, [ids]);
  });
}
