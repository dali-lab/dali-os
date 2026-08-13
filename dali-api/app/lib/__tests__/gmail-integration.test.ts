import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  getSender,
  getSenderRefreshToken,
  getApplicationsGmailRefreshToken,
  isSenderConnected,
  noteSenderHealth,
} from "~/lib/gmail-integration";

const mockPrisma = prisma as unknown as {
  gmailIntegration: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSenderRefreshToken", () => {
  it("returns the purpose's own token when connected", async () => {
    mockPrisma.gmailIntegration.findFirst.mockResolvedValue({
      oauthTokens: "edu-token",
    });

    const token = await getSenderRefreshToken("Education");

    expect(token).toBe("edu-token");
    expect(mockPrisma.gmailIntegration.findFirst).toHaveBeenCalledTimes(1);
    expect(mockPrisma.gmailIntegration.findFirst.mock.calls[0][0].where).toEqual({
      purpose: "Education",
      enabled: true,
    });
  });

  it("falls back to the Hiring integration when the purpose has none", async () => {
    mockPrisma.gmailIntegration.findFirst
      .mockResolvedValueOnce(null) // no General row
      .mockResolvedValueOnce({ oauthTokens: "applications-token" });

    const token = await getSenderRefreshToken("General");

    expect(token).toBe("applications-token");
    expect(mockPrisma.gmailIntegration.findFirst).toHaveBeenCalledTimes(2);
    expect(mockPrisma.gmailIntegration.findFirst.mock.calls[1][0].where).toEqual({
      purpose: "Hiring",
      enabled: true,
    });
  });

  it("does not fall back from Hiring itself", async () => {
    mockPrisma.gmailIntegration.findFirst.mockResolvedValue(null);

    const token = await getSenderRefreshToken("Hiring");

    expect(token).toBeNull();
    expect(mockPrisma.gmailIntegration.findFirst).toHaveBeenCalledTimes(1);
  });

  it("keeps the historical applications alias on the Hiring purpose", async () => {
    mockPrisma.gmailIntegration.findFirst.mockResolvedValue({
      oauthTokens: "applications-token",
    });

    const token = await getApplicationsGmailRefreshToken();

    expect(token).toBe("applications-token");
    expect(mockPrisma.gmailIntegration.findFirst.mock.calls[0][0].where).toEqual({
      purpose: "Hiring",
      enabled: true,
    });
  });
});

describe("getSender", () => {
  it("returns the identity to send-as alongside the token", async () => {
    mockPrisma.gmailIntegration.findFirst.mockResolvedValue({
      id: "g-1",
      oauthTokens: "gen-token",
      sendAsEmail: "dalios@dali.dartmouth.edu",
    });

    const sender = await getSender("General");

    expect(sender).toEqual({
      id: "g-1",
      refreshToken: "gen-token",
      sendAsEmail: "dalios@dali.dartmouth.edu",
    });
  });

  it("falls back to the Hiring identity — including its sendAsEmail — when the purpose has none", async () => {
    mockPrisma.gmailIntegration.findFirst
      .mockResolvedValueOnce(null) // no General row
      .mockResolvedValueOnce({
        id: "h-1",
        oauthTokens: "applications-token",
        sendAsEmail: "applications@dali.dartmouth.edu",
      });

    const sender = await getSender("General");

    expect(sender).toEqual({
      id: "h-1",
      refreshToken: "applications-token",
      sendAsEmail: "applications@dali.dartmouth.edu",
    });
    expect(mockPrisma.gmailIntegration.findFirst.mock.calls[1][0].where).toEqual({
      purpose: "Hiring",
      enabled: true,
    });
  });

  it("returns null when nothing is connected and does not fall back from Hiring", async () => {
    mockPrisma.gmailIntegration.findFirst.mockResolvedValue(null);
    expect(await getSender("Hiring")).toBeNull();
    expect(mockPrisma.gmailIntegration.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("noteSenderHealth", () => {
  it("records an error and never touches lastUsedAt", async () => {
    mockPrisma.gmailIntegration.update.mockResolvedValue({});
    await noteSenderHealth("g-1", "invalid_grant");
    expect(mockPrisma.gmailIntegration.update).toHaveBeenCalledWith({
      where: { id: "g-1" },
      data: { syncError: "invalid_grant" },
    });
  });

  it("clears the error and stamps lastUsedAt on success", async () => {
    mockPrisma.gmailIntegration.update.mockResolvedValue({});
    await noteSenderHealth("g-1", null);
    const data = mockPrisma.gmailIntegration.update.mock.calls[0][0].data;
    expect(data.syncError).toBeNull();
    expect(data.lastUsedAt).toBeInstanceOf(Date);
  });

  it("swallows a failed health write so it can't mask the send", async () => {
    mockPrisma.gmailIntegration.update.mockRejectedValue(new Error("db down"));
    await expect(noteSenderHealth("g-1", "boom")).resolves.toBeUndefined();
  });
});

describe("isSenderConnected", () => {
  it("reports only the purpose's own connection — no fallback", async () => {
    mockPrisma.gmailIntegration.findFirst.mockResolvedValue(null);

    expect(await isSenderConnected("Partners")).toBe(false);
    expect(mockPrisma.gmailIntegration.findFirst).toHaveBeenCalledTimes(1);
  });
});
