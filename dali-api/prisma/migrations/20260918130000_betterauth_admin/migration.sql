-- BetterAuth migration — admin plugin (Phase 3, impersonation).
--
-- Additive and safe on populated data (all columns nullable / defaulted). The
-- admin plugin (app/lib/betterauth.server.ts) requires these:
--   User.role       — only used to satisfy the plugin's impersonate gate; the
--                     /admin/impersonate route JIT-sets it to "admin" for the
--                     acting admin. Real authorization stays in the role tables.
--   User.banned/banReason/banExpires — unused (we don't use the ban feature),
--                     but the plugin's session hook references user.banned.
--   AuthSession.impersonatedBy — the impersonating admin's userId while an
--                     impersonation session is active (null otherwise).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "banExpires" TIMESTAMP(3),
ADD COLUMN     "banReason" TEXT,
ADD COLUMN     "banned" BOOLEAN DEFAULT false,
ADD COLUMN     "role" TEXT;

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "impersonatedBy" TEXT;
