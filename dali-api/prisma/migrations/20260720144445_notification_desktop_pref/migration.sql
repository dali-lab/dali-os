-- Desktop-app native banner sub-preference. Defaults on so existing rows and
-- row-less users keep today's behavior (every in-app item banners on desktop).
ALTER TABLE "NotificationPreference" ADD COLUMN "desktop" BOOLEAN NOT NULL DEFAULT true;
