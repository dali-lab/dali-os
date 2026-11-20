import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  class MailboxError extends Error {}
  return { emailAccessDenied: vi.fn(), readableMailAccounts: vi.fn(), MailboxError };
});

vi.mock("~/email/lib/email.server", () => ({ emailAccessDenied: m.emailAccessDenied }));
vi.mock("~/email/lib/access.server", () => ({ readableMailAccounts: m.readableMailAccounts }));
vi.mock("~/email/lib/gmail-mailbox.server", () => ({ MailboxError: m.MailboxError }));

import type { McpCtx } from "~/mcp/registry";
import { McpError, McpForbiddenError, McpInvalidError, McpNotFoundError } from "~/mcp/errors";
import { labelNamer, mcpMailAccount, mcpMailAccounts, withGmail } from "../shared";

const ctx = { user: { id: "u1" }, scopes: [], request: new Request("https://os.example.edu/mcp") } as unknown as McpCtx;
const account = (o: Record<string, unknown>) => ({ id: "a1", kind: "Shared", oauthTokens: { x: 1 }, ...o });

beforeEach(() => {
  vi.resetAllMocks();
  m.emailAccessDenied.mockResolvedValue(false);
  m.readableMailAccounts.mockResolvedValue([account({}), account({ id: "a2", kind: "Personal" })]);
});

describe("mcpMailAccounts", () => {
  it("never lists Personal inboxes", async () => {
    expect((await mcpMailAccounts(ctx)).map((a) => a.id)).toEqual(["a1"]);
  });

  it("refuses a user without email access before reading any inbox", async () => {
    m.emailAccessDenied.mockResolvedValue(true);
    await expect(mcpMailAccounts(ctx)).rejects.toThrow(new McpForbiddenError("Email isn't available to your account."));
    expect(m.readableMailAccounts).not.toHaveBeenCalled();
  });
});

describe("mcpMailAccount", () => {
  it("returns a connected inbox", async () => {
    expect((await mcpMailAccount(ctx, "a1")).id).toBe("a1");
  });

  it("answers an unknown id and a Personal inbox as not found", async () => {
    await expect(mcpMailAccount(ctx, "nope")).rejects.toBeInstanceOf(McpNotFoundError);
    await expect(mcpMailAccount(ctx, "a2")).rejects.toThrow("Inbox not found");
  });

  it("asks for the inbox to be connected first", async () => {
    m.readableMailAccounts.mockResolvedValue([account({ oauthTokens: null })]);
    const err = await mcpMailAccount(ctx, "a1").catch((e) => e);
    expect(err).toBeInstanceOf(McpInvalidError);
    expect(err.message).toBe("Connect this inbox in Email first.");
  });
});

describe("withGmail", () => {
  it("returns the result", async () => {
    expect(await withGmail(async () => 5)).toBe(5);
  });

  it("turns a mailbox failure into a 502 with a plain message", async () => {
    const err = await withGmail(async () => Promise.reject(new m.MailboxError("raw"))).catch((e) => e);
    expect(err).toBeInstanceOf(McpError);
    expect(err).toMatchObject({ status: 502, message: "Gmail didn't respond. Try again." });
  });

  it("passes other errors through", async () => {
    const boom = new Error("boom");
    await expect(withGmail(async () => Promise.reject(boom))).rejects.toBe(boom);
  });
});

describe("labelNamer", () => {
  it("maps ids to names and keeps unknown ids", () => {
    expect(labelNamer([{ id: "Label_1", name: "Partners" }])(["Label_1", "INBOX"])).toEqual(["Partners", "INBOX"]);
  });
});
