-- Postgres init script for the local docker-compose dev DB.
--
-- `prisma db push --force-reset` (run by compose on every boot) does both:
--   1. skips the migrations folder, so `CREATE EXTENSION` statements inside
--      migrations never execute against this DB; and
--   2. drops schema `public` cascade before recreating it, which would also
--      drop any extension installed into `public`.
--
-- So we park the extension in a dedicated `extensions` schema that db push
-- never touches, and set the database-level search_path so bare references
-- like `gin_trgm_ops` keep resolving after the public schema is rebuilt.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
ALTER DATABASE dali SET search_path TO "$user", public, extensions;
