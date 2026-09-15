import { describe, it, expect } from "vitest";
import { describeCalendarSyncError } from "../sync-error";

describe("describeCalendarSyncError", () => {
  it("returns null when there is no error", () => {
    expect(describeCalendarSyncError(null)).toBeNull();
    expect(describeCalendarSyncError(undefined)).toBeNull();
    expect(describeCalendarSyncError("")).toBeNull();
  });

  it("flags a missing-calendar-scope 403 as needing reconnect", () => {
    const raw =
      "Google events.list failed (403): insufficientPermissions: Request had insufficient authentication scopes.";
    const info = describeCalendarSyncError(raw);
    expect(info).not.toBeNull();
    expect(info!.needsReconnect).toBe(true);
    expect(info!.raw).toBe(raw);
    expect(info!.message).not.toContain("403");
  });

  it("matches the human 'insufficient authentication scopes' phrasing too", () => {
    const info = describeCalendarSyncError(
      "events failed: insufficient authentication scopes",
    );
    expect(info!.needsReconnect).toBe(true);
  });

  it("does not treat an unrelated failure as a scope problem", () => {
    const info = describeCalendarSyncError("Google token refresh failed (400)");
    expect(info!.needsReconnect).toBe(false);
    expect(info!.message).toBe("Sync error: Google token refresh failed (400)");
  });
});
