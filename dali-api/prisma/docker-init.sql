-- Postgres init script for the local docker-compose dev DB.
--
-- `prisma db push --force-reset` (run by compose on every boot) rebuilds the
-- schema straight from schema.prisma and skips the migrations folder, so the
-- `CREATE EXTENSION` statements that live inside migrations never run.
-- Postgres applies files in /docker-entrypoint-initdb.d/ once, when the data
-- directory is empty, giving us a durable place to declare the extensions
-- the schema's GIN indexes depend on.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
