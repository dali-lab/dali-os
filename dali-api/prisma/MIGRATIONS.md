# Database & Migrations Best Practices

## How the database works in this repo

| Environment | Database | Notes |
|---|---|---|
| Local | Docker Compose postgres (`localhost:5432/dali`) | Reset anytime with `npm run db:reset:local` |
| PR CI | Throwaway postgres:16 container | Spun up and torn down per run |
| Dev (`dali-api-dev`) | Neon `development` branch | Reset to match `production` on every deploy to `dev` |
| Prod (`dali-api-prod`) | Neon `production` branch | Migrations applied in place on every deploy |

Migrations run automatically as a Fly.io release command (`npx prisma migrate deploy`) on every deployment. On dev, the Neon branch is first restored from production, so migrations always run against a clean prod-like state.

### Why we set both `DATABASE_URL` and `DIRECT_URL`

`prisma migrate deploy` acquires a Postgres advisory lock (`pg_advisory_lock`) to serialize migration runs. Advisory locks are **session-scoped**, but Neon's pooler does PgBouncer-style transaction pooling: lock and unlock calls can land on different backend sessions, so the lock either never gets acquired (P1002 after 10s) or never gets released. See https://pris.ly/d/migrate-advisory-locking and issue #101.

The fix is to give Prisma two URLs:

- `DATABASE_URL` — pooled endpoint, used by the runtime (serverless-friendly, plays well with `@prisma/adapter-neon`).
- `DIRECT_URL` — non-pooled endpoint (strip `-pooler` from the hostname, or fetch with `pooled=false` from Neon's `connection_uri` API), used by `prisma migrate`.

Both must be set as Fly secrets on every deploy target (`dali-api-dev`, `dali-api-staging`, `dali-api-prod`):

```bash
flyctl secrets set DIRECT_URL='postgres://…@<branch>.<region>.neon.tech/neondb?sslmode=require' --app dali-api-<env>
```

The `directUrl` field is declared on `datasource db` in `schema.prisma` and on `prisma.config.ts`, so Prisma picks it up automatically — no release-command change needed.

## Making schema changes

Always use Prisma's migration workflow — never edit the database directly.

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate a migration
npx prisma migrate dev --name describe_your_change

# 3. Commit both schema.prisma and the new migration file together
```

The migration file in `prisma/migrations/` is the source of truth for what runs in production. The schema file is how you author changes locally.

## Rules

**Never delete or edit a migration file.** Once a migration has been applied to any shared environment (dev or prod), it is permanent. CI will fail any PR that deletes a migration file. If you made a mistake, create a new migration that corrects it.

**Never edit `schema.prisma` without generating a migration.** CI runs `prisma migrate diff` on every PR to detect drift between the schema and migrations. If they don't match, the check fails.

**Commit schema and migration together.** Pushing one without the other will cause CI to fail and will leave the repo in an inconsistent state.

**Give migrations descriptive names.** The name becomes part of the filename and the `_prisma_migrations` history.

```bash
# Good
npx prisma migrate dev --name add_reviewer_to_application

# Bad
npx prisma migrate dev --name update
npx prisma migrate dev --name fix
```

## Risky migrations

CI runs `pgfence` to flag migrations with high-risk operations. Common risky patterns and how to handle them:

| Operation | Risk | Safer approach |
|---|---|---|
| `DROP COLUMN` | Data loss | Make sure the column is unused in code before dropping |
| `ADD COLUMN NOT NULL` without default | Locks table | Add as nullable first, backfill, then add constraint |
| `ALTER COLUMN` type change | May fail if data is incompatible | Cast explicitly or migrate data first |
| Adding an index | Locks table on large datasets | Use `CREATE INDEX CONCURRENTLY` (write raw SQL migration) |

If `pgfence` blocks your PR, don't just suppress the check — rethink the migration approach.

## Local development

```bash
# Reset local database and re-seed from scratch
npm run db:reset:local

# Apply pending migrations without resetting
npx prisma migrate deploy

# Sync members from Notion → local database
npm run db:fetch:members && npm run db:seed:members
```

The local seed (`prisma/seed.ts`) creates test users, cycles, challenges, and applicants. It is not run in production.

## What not to do

- Do not run `prisma migrate reset` against dev or prod — it drops all data
- Do not manually insert or alter rows in the `_prisma_migrations` table
- Do not create migrations with past timestamps to reorder history
- Do not share a `DATABASE_URL` pointing to the production Neon branch locally
