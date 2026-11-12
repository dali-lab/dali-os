import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    domain: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/github", () => ({
  ensureTeam: vi.fn(),
  addTeamMember: vi.fn(),
  isNo2fa: vi.fn(),
}));
vi.mock("~/slack/lib/slack-client", () => ({ inviteToWorkspace: vi.fn() }));
vi.mock("~/lib/google-workspace", () => ({ provisionWorkspaceAccount: vi.fn() }));
vi.mock("~/slack/lib/slack-sync.server", () => ({ syncSlackUserId: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { ensureTeam, addTeamMember, isNo2fa } from "~/lib/github";
import { inviteToWorkspace } from "~/slack/lib/slack-client";
import { provisionWorkspaceAccount } from "~/lib/google-workspace";
import { syncSlackUserId } from "~/slack/lib/slack-sync.server";
import { provisionNewMember } from "../provisioning.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const USER = {
  firstName: "Ada",
  lastName: "Lovelace",
  githubUsername: "ada-l",
  daliEmail: null as string | null,
  dartmouthEmail: "ada@example.edu",
};

const savedOrg = process.env.GITHUB_ORG;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GITHUB_ORG = "dali-lab";
  db.user.findUnique.mockResolvedValue(USER);
  db.domain.findUnique.mockResolvedValue({ name: "Software Dev", displayName: "Software Dev", code: "SWE" });
  vi.mocked(provisionWorkspaceAccount).mockResolvedValue({
    status: "ok",
    email: "ada.lovelace@dali.dartmouth.edu",
    created: true,
    tempPassword: "fake-temp",
  });
  vi.mocked(inviteToWorkspace).mockResolvedValue({ message: "no admin token" } as never);
  vi.mocked(syncSlackUserId).mockResolvedValue({ status: "linked" } as never);
  vi.mocked(ensureTeam).mockResolvedValue({ slug: "swe" } as never);
  vi.mocked(addTeamMember).mockResolvedValue(undefined as never);
});

afterEach(() => {
  if (savedOrg === undefined) delete process.env.GITHUB_ORG;
  else process.env.GITHUB_ORG = savedOrg;
});

describe("provisionNewMember workspace step", () => {
  it("creates the account from the member's name with their Dartmouth email as recovery", async () => {
    await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(provisionWorkspaceAccount).toHaveBeenCalledWith({
      firstName: "Ada",
      lastName: "Lovelace",
      recoveryEmail: "ada@example.edu",
    });
  });

  it("reports the new address and temp password, and saves the address on the user", async () => {
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.workspace).toEqual({ status: "ok", message: "Created: ada.lovelace@dali.dartmouth.edu" });
    expect(res.daliEmail).toBe("ada.lovelace@dali.dartmouth.edu");
    expect(res.daliTempPassword).toBe("fake-temp");
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { daliEmail: "ada.lovelace@dali.dartmouth.edu" },
    });
  });

  it("is idempotent for an existing account: no temp password and no redundant user update", async () => {
    db.user.findUnique.mockResolvedValue({ ...USER, daliEmail: "ada.lovelace@dali.dartmouth.edu" });
    vi.mocked(provisionWorkspaceAccount).mockResolvedValue({
      status: "ok",
      email: "ada.lovelace@dali.dartmouth.edu",
      created: false,
    });
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.workspace.message).toBe("Exists: ada.lovelace@dali.dartmouth.edu");
    expect(res.daliTempPassword).toBeNull();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("corrects a stored DALI email that differs from the provisioned one", async () => {
    db.user.findUnique.mockResolvedValue({ ...USER, daliEmail: "old@dali.dartmouth.edu" });
    await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { daliEmail: "ada.lovelace@dali.dartmouth.edu" },
    });
  });

  it("keeps going when saving the email collides", async () => {
    db.user.update.mockRejectedValue(new Error("Unique constraint"));
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.workspace.status).toBe("ok");
    expect(res.slack.status).toBe("ok");
  });

  it("passes a skipped Workspace through and falls back to the stored DALI email", async () => {
    db.user.findUnique.mockResolvedValue({ ...USER, daliEmail: "ada@dali.dartmouth.edu" });
    vi.mocked(provisionWorkspaceAccount).mockResolvedValue({ status: "skipped", message: "not configured" });
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.workspace).toEqual({ status: "skipped", message: "not configured" });
    expect(res.daliEmail).toBe("ada@dali.dartmouth.edu");
    expect(res.daliTempPassword).toBeNull();
    expect(inviteToWorkspace).toHaveBeenCalledWith("ada@dali.dartmouth.edu", []);
  });

  it("reports a Workspace error without blocking Slack or GitHub", async () => {
    vi.mocked(provisionWorkspaceAccount).mockResolvedValue({ status: "error", message: "quota" });
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.workspace).toEqual({ status: "error", message: "quota" });
    expect(res.github.status).toBe("ok");
    expect(res.slack.status).toBe("ok");
  });

  it("does nothing external for an unknown user except sync Slack", async () => {
    db.user.findUnique.mockResolvedValue(null);
    const res = await provisionNewMember({ userId: "ghost", domainId: "d1" });
    expect(provisionWorkspaceAccount).not.toHaveBeenCalled();
    expect(res.daliEmail).toBeNull();
    expect(res.github.status).toBe("skipped");
  });
});

describe("provisionNewMember slack step", () => {
  it("skips the invite without a DALI email but still syncs the Slack id", async () => {
    vi.mocked(provisionWorkspaceAccount).mockResolvedValue({ status: "skipped", message: "x" });
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(inviteToWorkspace).not.toHaveBeenCalled();
    expect(syncSlackUserId).toHaveBeenCalledWith("u1");
    expect(res.slack).toEqual({
      status: "ok",
      message: "invite: skipped (no DALI email); slack id: linked",
    });
  });

  it("invites the provisioned address", async () => {
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(inviteToWorkspace).toHaveBeenCalledWith("ada.lovelace@dali.dartmouth.edu", []);
    expect(res.slack.message).toBe("invite: no admin token; slack id: linked");
  });

  it("records an error but still runs GitHub when Slack throws", async () => {
    vi.mocked(syncSlackUserId).mockRejectedValue(new Error("slack down"));
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.slack).toEqual({ status: "error", message: "slack down" });
    expect(addTeamMember).toHaveBeenCalled();
  });
});

describe("provisionNewMember github step", () => {
  it("skips when GITHUB_ORG is unset", async () => {
    delete process.env.GITHUB_ORG;
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.github).toEqual({ status: "skipped", message: "GITHUB_ORG not set." });
    expect(ensureTeam).not.toHaveBeenCalled();
  });

  it("skips a member with a blank GitHub username", async () => {
    db.user.findUnique.mockResolvedValue({ ...USER, githubUsername: "   " });
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.github).toEqual({ status: "skipped", message: "Member has no GitHub username yet." });
    expect(addTeamMember).not.toHaveBeenCalled();
  });

  it("skips when the domain is gone", async () => {
    db.domain.findUnique.mockResolvedValue(null);
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.github).toEqual({ status: "skipped", message: "Domain not found." });
  });

  it("adds the trimmed username to a team slugged from the domain code", async () => {
    db.user.findUnique.mockResolvedValue({ ...USER, githubUsername: "  ada-l " });
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(ensureTeam).toHaveBeenCalledWith("swe");
    expect(addTeamMember).toHaveBeenCalledWith("swe", "ada-l");
    expect(res.github).toEqual({ status: "ok", message: 'Added ada-l to team "swe".' });
  });

  it("slugs from the domain name when there is no code", async () => {
    db.domain.findUnique.mockResolvedValue({ name: "  Product & Design!  ", displayName: "x", code: null });
    await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(ensureTeam).toHaveBeenCalledWith("product-design");
  });

  it("explains the two-factor requirement", async () => {
    vi.mocked(addTeamMember).mockRejectedValue(new Error("422"));
    vi.mocked(isNo2fa).mockReturnValue(true);
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.github).toEqual({
      status: "error",
      message: "Member must enable two-factor auth on GitHub before they can join the org.",
    });
  });

  it("surfaces other GitHub failures verbatim", async () => {
    vi.mocked(ensureTeam).mockRejectedValue(new Error("rate limited"));
    vi.mocked(isNo2fa).mockReturnValue(false);
    const res = await provisionNewMember({ userId: "u1", domainId: "d1" });
    expect(res.github).toEqual({ status: "error", message: "rate limited" });
  });
});
