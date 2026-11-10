import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db.server");

import { mapToolError } from "~/mcp/errors";
import { MemberNotFoundError } from "~/mcp/tools/get-member-profile";
import { ProjectNotFoundError } from "~/mcp/tools/get-project-overview";
import {
  NotificationNotFoundError,
  NotificationForbiddenError,
} from "~/mcp/tools/mark-notification-read";
import { ProjectSettingsNotFoundError } from "~/mcp/tools/project-settings";
import {
  ShowcaseNotFoundError,
  ShowcaseForbiddenError,
  ShowcaseInvalidError,
} from "~/mcp/tools/project-showcase";
import { ScheduleMeetingError } from "~/mcp/tools/schedule-meeting";
import {
  StaffingForbiddenError,
  StaffingNotFoundError,
  StaffingInvalidError,
} from "~/mcp/tools/staffing";

describe("tool error classes map to the JSON-RPC codes the route has always returned", () => {
  it.each([
    ["MemberNotFoundError", new MemberNotFoundError("m1"), -32004],
    ["ProjectNotFoundError", new ProjectNotFoundError("p1"), -32004],
    ["NotificationNotFoundError", new NotificationNotFoundError("n1"), -32004],
    ["NotificationForbiddenError", new NotificationForbiddenError(), -32003],
    ["ProjectSettingsNotFoundError", new ProjectSettingsNotFoundError("p1"), -32004],
    ["ShowcaseNotFoundError", new ShowcaseNotFoundError("p1"), -32004],
    ["ShowcaseForbiddenError", new ShowcaseForbiddenError("no"), -32003],
    ["ShowcaseInvalidError", new ShowcaseInvalidError("bad"), -32602],
    ["ScheduleMeetingError", new ScheduleMeetingError("bad"), -32602],
    ["StaffingForbiddenError", new StaffingForbiddenError(), -32003],
    ["StaffingNotFoundError", new StaffingNotFoundError("Cycle"), -32004],
    ["StaffingInvalidError", new StaffingInvalidError("bad"), -32602],
  ])("%s → %i", (_name, err, code) => {
    expect(mapToolError(err)).toEqual({ code, message: err.message });
  });
});
