import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("../check-in-to-meeting", () => ({ runCheckInToMeeting: vi.fn() }));
vi.mock("../../education/check-in-to-session", () => ({ runCheckInToSession: vi.fn() }));

import { CHECK_IN_DEF, runCheckIn } from "../check-in";
import { runCheckInToMeeting } from "../check-in-to-meeting";
import { runCheckInToSession } from "../../education/check-in-to-session";
import { findRegistryTool } from "~/mcp/registry";
import { ADDITIVE_TOOLS, toolAnnotations } from "~/mcp/tool-policy";

const ctx = { user: { id: "u1" }, scopes: ["mcp:write"], request: new Request("http://x") } as never;

beforeEach(() => vi.clearAllMocks());

describe("check_in", () => {
  it("is an additive write tool", () => {
    expect(CHECK_IN_DEF.requiredScope).toBe("mcp:write");
    expect(ADDITIVE_TOOLS.has("check_in")).toBe(true);
    expect(toolAnnotations(findRegistryTool("check_in")!.def)).toMatchObject({ destructiveHint: false });
  });

  it("checks in to a meeting as the caller", async () => {
    vi.mocked(runCheckInToMeeting).mockResolvedValue({ ok: true });
    await expect(runCheckIn(ctx, { meetingId: "m1" })).resolves.toEqual({ ok: true });
    expect(runCheckInToMeeting).toHaveBeenCalledWith("u1", { meetingId: "m1" });
    expect(runCheckInToSession).not.toHaveBeenCalled();
  });

  it("checks in to an education session as the caller", async () => {
    vi.mocked(runCheckInToSession).mockResolvedValue({ ok: true, alreadyPresent: false });
    await expect(runCheckIn(ctx, { sessionId: "s1" })).resolves.toEqual({ ok: true, alreadyPresent: false });
    expect(runCheckInToSession).toHaveBeenCalledWith(ctx, { sessionId: "s1" });
    expect(runCheckInToMeeting).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ meetingId: "m1", sessionId: "s1" }]])("rejects %j", async (args) => {
    await expect(runCheckIn(ctx, args)).rejects.toMatchObject({ name: "McpInvalidError" });
    expect(runCheckInToMeeting).not.toHaveBeenCalled();
    expect(runCheckInToSession).not.toHaveBeenCalled();
  });

  it("passes a session check-in rejection through", async () => {
    vi.mocked(runCheckInToSession).mockRejectedValue(Object.assign(new Error("closed"), { status: 403 }));
    await expect(runCheckIn(ctx, { sessionId: "s1" })).rejects.toMatchObject({ status: 403 });
  });
});
