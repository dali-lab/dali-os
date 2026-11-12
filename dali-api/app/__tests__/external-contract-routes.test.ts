import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routesSource = readFileSync(join(import.meta.dirname, "..", "routes.ts"), "utf8");

const CONTRACTS: Record<string, string[]> = {
  "mobile app": [
    "api/mobile/me",
    "api/mobile/projects",
    "api/mobile/projects/:id",
    "api/mobile/calendar",
    "api/mobile/pass",
    "api/mobile/time",
    "api/mobile/time/:id",
    "api/mobile/notes",
    "api/mobile/notes/:id",
    "api/mobile/webview",
    "api/mobile/people",
    "api/meeting-recordings",
    "api/meeting-recordings/active",
    "api/meeting-recordings/:id",
    "api/meeting-recordings/:id/chunks",
    "api/meeting-recordings/:id/result",
    "api/tasks/:id/move",
    "api/notebooks",
    "api/notebooks/:id",
    "api/notifications/:id/rsvp",
    "api/wallet/google/save-url",
    "auth/handoff",
  ],
  "iOS room display": [
    "api/room-display/activate",
    "api/room-display/schedule",
    "api/room-display/book",
    "api/room-display/scan",
    "api/room-display/bookings/:id",
  ],
  "desktop app": [
    "api/desktop/version",
    "api/desktop/updated",
    "api/desktop/agenda",
    "calendar/meeting/:id",
    "auth/pair/start",
    "auth/pair/approve",
    "auth/pair/poll",
    "auth/handoff",
    "link",
    "api/notifications",
    "api/notifications/stream",
    "api/notifications/:id/read",
    "api/notifications/:id/rsvp",
  ],
  "JobX extension": ["api/timesheets/export"],
};

describe("external contract routes stay registered", () => {
  for (const [client, paths] of Object.entries(CONTRACTS)) {
    it.each(paths)(`${client}: %s`, (path) => {
      expect(routesSource, `removing or renaming "${path}" breaks the ${client}`).toContain(`route("${path}"`);
    });
  }
});
