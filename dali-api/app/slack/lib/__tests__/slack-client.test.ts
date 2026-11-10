import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  inviteCalls: [] as unknown[],
  inviteError: null as Error | null,
}));

vi.mock("@slack/web-api", () => ({
  WebClient: class {
    token: string;
    constructor(token: string) {
      this.token = token;
    }
    admin = {
      users: {
        invite: async (args: unknown) => {
          h.inviteCalls.push({ token: this.token, args });
          if (h.inviteError) throw h.inviteError;
        },
      },
    };
  },
}));

import {
  slackConfigured,
  fetchThread,
  postReply,
  postMessage,
  postBlocks,
  sendDm,
  getPermalink,
  inviteToWorkspace,
  lookupSlackUserByEmail,
  ensureChannel,
  inviteUsersToChannel,
  slackErrorMessage,
  slackMissingScopeMsg,
  __setSlackClientForTests,
} from "../slack-client";

function fakeClient() {
  return {
    conversations: {
      replies: vi.fn(),
      create: vi.fn(),
      list: vi.fn(),
      unarchive: vi.fn(),
      invite: vi.fn(),
    },
    chat: { postMessage: vi.fn(), getPermalink: vi.fn(), update: vi.fn() },
    users: { lookupByEmail: vi.fn() },
  };
}
let c: ReturnType<typeof fakeClient>;

beforeEach(() => {
  h.inviteCalls = [];
  h.inviteError = null;
  c = fakeClient();
  __setSlackClientForTests(c as never);
  process.env.SLACK_BOT_TOKEN = "xoxb-fake";
});
afterEach(() => {
  __setSlackClientForTests(null);
  for (const k of ["SLACK_BOT_TOKEN", "SLACK_ADMIN_TOKEN", "SLACK_TEAM_ID"]) delete process.env[k];
});

describe("slackConfigured", () => {
  it("tracks whether a bot token is set", () => {
    expect(slackConfigured()).toBe(true);
    delete process.env.SLACK_BOT_TOKEN;
    expect(slackConfigured()).toBe(false);
  });
});

describe("posting", () => {
  it("fetchThread maps messages and files, defaulting missing fields", async () => {
    c.conversations.replies.mockResolvedValue({
      messages: [
        { ts: "1.1", user: "U1", text: "hi", files: [{ id: "F1", name: "a.png", mimetype: "image/png", urlPrivate: "https://files.example/a" }] },
        { text: undefined },
      ],
    });
    expect(await fetchThread("C1", "1.1")).toEqual([
      { ts: "1.1", user: "U1", text: "hi", files: [{ id: "F1", name: "a.png", mimetype: "image/png", urlPrivate: "https://files.example/a" }] },
      { ts: "", user: null, text: "", files: [] },
    ]);
    expect(c.conversations.replies).toHaveBeenCalledWith({ channel: "C1", ts: "1.1", limit: 200 });
  });

  it("postReply threads under the parent and returns the new ts", async () => {
    c.chat.postMessage.mockResolvedValue({ ts: "2.2" });
    expect(await postReply("C1", "1.1", "yo")).toEqual({ ts: "2.2" });
    expect(c.chat.postMessage).toHaveBeenCalledWith({ channel: "C1", thread_ts: "1.1", text: "yo" });
  });

  it("postMessage and postBlocks post top-level; sendDm addresses the Slack user id", async () => {
    c.chat.postMessage.mockResolvedValue({ ts: "3.3" });
    await postMessage("C1", "roster");
    expect(c.chat.postMessage).toHaveBeenLastCalledWith({ channel: "C1", text: "roster" });
    await postBlocks("C1", [{ type: "divider" }], "fallback");
    expect(c.chat.postMessage).toHaveBeenLastCalledWith({ channel: "C1", blocks: [{ type: "divider" }], text: "fallback" });
    await sendDm("U42", "hello");
    expect(c.chat.postMessage).toHaveBeenLastCalledWith({ channel: "U42", text: "hello" });
  });

  it.each([
    ["postReply", () => postReply("C1", "1.1", "x")],
    ["postMessage", () => postMessage("C1", "x")],
    ["postBlocks", () => postBlocks("C1", [], "x")],
    ["sendDm", () => sendDm("U1", "x")],
  ])("%s fails loudly when Slack returns no ts", async (_n, call) => {
    c.chat.postMessage.mockResolvedValue({});
    await expect(call()).rejects.toThrow("chat.postMessage returned no ts");
  });

  it("getPermalink returns null when Slack has none", async () => {
    c.chat.getPermalink.mockResolvedValue({ permalink: "https://slack.example/p1" });
    expect(await getPermalink("C1", "1.1")).toBe("https://slack.example/p1");
    c.chat.getPermalink.mockResolvedValue({});
    expect(await getPermalink("C1", "1.1")).toBeNull();
  });
});

describe("the bot client", () => {
  it("throws a clear error when no token is configured and no client is injected", async () => {
    __setSlackClientForTests(null);
    delete process.env.SLACK_BOT_TOKEN;
    await expect(postMessage("C1", "x")).rejects.toThrow("SLACK_BOT_TOKEN is not set");
  });
});

describe("lookupSlackUserByEmail", () => {
  it("returns null without calling Slack when the bot token is unset", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    expect(await lookupSlackUserByEmail("ada@example.edu")).toBeNull();
    expect(c.users.lookupByEmail).not.toHaveBeenCalled();
  });

  it("resolves the user id, and treats any Slack error as no account", async () => {
    c.users.lookupByEmail.mockResolvedValue({ user: { id: "U9" } });
    expect(await lookupSlackUserByEmail("ada@example.edu")).toBe("U9");
    expect(c.users.lookupByEmail).toHaveBeenCalledWith({ email: "ada@example.edu" });
    c.users.lookupByEmail.mockRejectedValue(new Error("users_not_found"));
    expect(await lookupSlackUserByEmail("ada@example.edu")).toBeNull();
  });
});

describe("inviteToWorkspace", () => {
  beforeEach(() => {
    process.env.SLACK_ADMIN_TOKEN = "xoxp-fake-admin";
    process.env.SLACK_TEAM_ID = "T1";
  });

  it("skips (without throwing) when the admin token or team id is missing", async () => {
    delete process.env.SLACK_ADMIN_TOKEN;
    expect((await inviteToWorkspace("ada@example.edu", ["C1"])).status).toBe("skipped");
    process.env.SLACK_ADMIN_TOKEN = "xoxp-fake-admin";
    delete process.env.SLACK_TEAM_ID;
    expect((await inviteToWorkspace("ada@example.edu", ["C1"])).status).toBe("skipped");
    expect(h.inviteCalls).toEqual([]);
  });

  it("invites with the ADMIN token (not the bot token) into the given channels", async () => {
    expect(await inviteToWorkspace("ada@example.edu", ["C1", "C2"])).toEqual({
      status: "ok",
      message: "Invited ada@example.edu to Slack.",
    });
    expect(h.inviteCalls).toEqual([
      { token: "xoxp-fake-admin", args: { team_id: "T1", email: "ada@example.edu", channel_ids: ["C1", "C2"] } },
    ]);
  });

  it("defaults to #general when no channels are given", async () => {
    c.conversations.list.mockResolvedValue({ channels: [{ id: "CG", name: "general" }] });
    await inviteToWorkspace("ada@example.edu", []);
    expect((h.inviteCalls[0] as any).args.channel_ids).toEqual(["CG"]);
  });

  it("skips when #general cannot be resolved", async () => {
    c.conversations.list.mockResolvedValue({ channels: [] });
    const out = await inviteToWorkspace("ada@example.edu", []);
    expect(out.status).toBe("skipped");
    expect(h.inviteCalls).toEqual([]);
  });

  it("counts already-in-team / already-invited as success and reports other errors", async () => {
    h.inviteError = new Error("An API error occurred: already_invited");
    expect((await inviteToWorkspace("ada@example.edu", ["C1"])).message).toBe("ada@example.edu already in Slack.");
    h.inviteError = new Error("already_in_team");
    expect((await inviteToWorkspace("ada@example.edu", ["C1"])).status).toBe("ok");
    h.inviteError = new Error("not_allowed_token_type");
    expect(await inviteToWorkspace("ada@example.edu", ["C1"])).toEqual({
      status: "error",
      message: "not_allowed_token_type",
    });
  });
});

describe("ensureChannel", () => {
  it("creates the channel under its sanitized name", async () => {
    c.conversations.create.mockResolvedValue({ channel: { id: "C1", name: "proj-x" } });
    expect(await ensureChannel("Proj X")).toEqual({ id: "C1", name: "proj-x", created: true });
    expect(c.conversations.create).toHaveBeenCalledWith({ name: "proj-x" });
  });

  it("resolves the existing channel on name_taken without unarchiving a live one", async () => {
    c.conversations.create.mockRejectedValue(new Error("name_taken"));
    c.conversations.list.mockResolvedValue({ channels: [{ id: "C7", name: "proj-x", is_archived: false }] });
    expect(await ensureChannel("proj-x")).toEqual({ id: "C7", name: "proj-x", created: false });
    expect(c.conversations.unarchive).not.toHaveBeenCalled();
  });

  it("unarchives an archived channel it resolves", async () => {
    c.conversations.create.mockRejectedValue(new Error("name_taken"));
    c.conversations.list.mockResolvedValue({ channels: [{ id: "C7", name: "proj-x", is_archived: true }] });
    await ensureChannel("proj-x");
    expect(c.conversations.unarchive).toHaveBeenCalledWith({ channel: "C7" });
  });

  it("pages through channel listings to find the match", async () => {
    c.conversations.create.mockRejectedValue(new Error("name_taken"));
    c.conversations.list
      .mockResolvedValueOnce({ channels: [{ id: "C1", name: "other" }], response_metadata: { next_cursor: "p2" } })
      .mockResolvedValueOnce({ channels: [{ id: "C7", name: "proj-x" }] });
    expect((await ensureChannel("proj-x")).id).toBe("C7");
    expect(c.conversations.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "p2" }));
  });

  it("explains a name_taken it cannot resolve as a missing channels:read scope", async () => {
    c.conversations.create.mockRejectedValue(new Error("name_taken"));
    c.conversations.list.mockResolvedValue({ channels: [] });
    await expect(ensureChannel("proj-x")).rejects.toThrow(/channels:read/);
  });

  it("rethrows other create errors", async () => {
    c.conversations.create.mockRejectedValue(new Error("restricted_action"));
    await expect(ensureChannel("proj-x")).rejects.toThrow("restricted_action");
  });

  it("fails when Slack returns no channel id", async () => {
    c.conversations.create.mockResolvedValue({ channel: {} });
    await expect(ensureChannel("proj-x")).rejects.toThrow("returned no channel id");
  });
});

describe("inviteUsersToChannel", () => {
  it("does nothing for an empty list and dedupes/filters blanks otherwise", async () => {
    expect(await inviteUsersToChannel("C1", ["", ""])).toEqual({ invited: 0, skipped: 0 });
    expect(c.conversations.invite).not.toHaveBeenCalled();
    expect(await inviteUsersToChannel("C1", ["U1", "U1", "U2", ""])).toEqual({ invited: 2, skipped: 0 });
    expect(c.conversations.invite).toHaveBeenCalledWith({ channel: "C1", users: "U1,U2" });
  });

  it("reports everyone as skipped when all are already in the channel, and rethrows other errors", async () => {
    c.conversations.invite.mockRejectedValue(new Error("already_in_channel"));
    expect(await inviteUsersToChannel("C1", ["U1", "U2"])).toEqual({ invited: 0, skipped: 2 });
    c.conversations.invite.mockRejectedValue(new Error("channel_not_found"));
    await expect(inviteUsersToChannel("C1", ["U1"])).rejects.toThrow("channel_not_found");
  });
});

describe("error formatting", () => {
  it("names the exact missing scope when Slack says which", () => {
    const err = Object.assign(new Error("missing_scope"), { data: { needed: "im:write" } });
    expect(slackMissingScopeMsg(err, "missing_scope")).toContain('"im:write" scope');
    expect(slackErrorMessage(err)).toContain('"im:write" scope');
  });

  it("falls back to a generic scope hint without `needed`", () => {
    expect(slackMissingScopeMsg(new Error("x"), "missing_scope")).toContain("missing a required scope");
  });

  it("hints to invite the bot for channel membership errors", () => {
    expect(slackErrorMessage(new Error("not_in_channel"))).toContain("isn't a member of that channel");
    expect(slackErrorMessage(new Error("channel_not_found"))).toContain("Invite the bot");
  });

  it("gives the GitHub teams hint only for a Not Found on teams/members", () => {
    expect(slackErrorMessage(new Error("Not Found - /orgs/x/teams/members"))).toContain("Members: read & write");
    expect(slackErrorMessage(new Error("Not Found"))).toBe("Not Found");
  });

  it("returns other messages unchanged, preferring the explicit raw string", () => {
    expect(slackErrorMessage("boom")).toBe("boom");
    expect(slackErrorMessage(new Error("ignored"), "raw text")).toBe("raw text");
  });
});
