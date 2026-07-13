-- Additive enum value for education notifications. Isolated in its own
-- migration: a value added by ALTER TYPE cannot be used later in the same
-- transaction, so it must not share a migration with DDL/DML that uses it.
ALTER TYPE "NotificationKind" ADD VALUE 'Education';
