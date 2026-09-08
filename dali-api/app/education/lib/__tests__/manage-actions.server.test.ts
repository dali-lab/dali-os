import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/gmail-integration", () => ({
  getSender: vi.fn().mockResolvedValue(null),
  noteSenderHealth: vi.fn(),
}));
vi.mock("~/education/lib/access.server", () => ({
  isOfferingManager: vi.fn(),
}));
vi.mock("~/education/lib/offerings.server", () => ({
  runOfferingAction: vi.fn(),
}));

import { isOfferingManager } from "~/education/lib/access.server";
import { runOfferingAction } from "~/education/lib/offerings.server";
import {
  runManageAction,
  MANAGE_CONTENT_INTENTS,
} from "~/education/lib/manage-actions.server";

const mockIsManager = isOfferingManager as unknown as ReturnType<typeof vi.fn>;
const mockRunOfferingAction = runOfferingAction as unknown as ReturnType<typeof vi.fn>;

const ctx = { offeringId: "off-1", actorId: "user-1" };

function form(intent: string, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("intent", intent);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

describe("runManageAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("covers every intent the old manage-route switch handled", () => {
    // Parity with the pre-extraction route action — including the two intents
    // its hand-maintained guard list dropped (approve-all-pending and
    // preview-close-out fell through to runOfferingAction and 400ed).
    expect([...MANAGE_CONTENT_INTENTS].sort()).toEqual(
      [
        "decide-application",
        "approve-all-pending",
        "create-page",
        "move-page",
        "move-file",
        "set-material-session",
        "create-assignment",
        "update-assignment",
        "delete-assignment",
        "post-announcement",
        "save-attendance",
        "set-session-check-in",
        "save-student-note",
        "close-out-offering",
        "preview-close-out",
        "set-form-binding",
      ].sort(),
    );
  });

  it("403s every content intent for non-managers without touching handlers", async () => {
    mockIsManager.mockResolvedValue(false);
    for (const intent of MANAGE_CONTENT_INTENTS) {
      const result = await runManageAction(form(intent), ctx);
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(403);
    }
    expect(mockRunOfferingAction).not.toHaveBeenCalled();
  });

  it("falls through unknown intents to runOfferingAction with the offering id pinned", async () => {
    mockRunOfferingAction.mockResolvedValue({ ok: true, id: "off-1" });
    const fd = form("update-offering", { offeringId: "someone-elses-offering" });

    const result = await runManageAction(fd, ctx);

    expect(mockRunOfferingAction).toHaveBeenCalledTimes(1);
    const [passedForm] = mockRunOfferingAction.mock.calls[0];
    expect(passedForm.get("offeringId")).toBe("off-1");
    expect(result).toEqual({ ok: true, id: "off-1" });
    // The content-intent gate is not consulted on the fallthrough path —
    // runOfferingAction does its own per-intent authorization.
    expect(mockIsManager).not.toHaveBeenCalled();
  });

  it("wraps runOfferingAction errors in a status Response", async () => {
    mockRunOfferingAction.mockResolvedValue({ error: "Forbidden", status: 403 });

    const result = await runManageAction(form("delete-offering"), ctx);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });
});
