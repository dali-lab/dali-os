-- Set when the member picks "Don't show again" on the desktop app hint.
ALTER TABLE "User" ADD COLUMN "desktopHintDismissedAt" TIMESTAMP(3);
