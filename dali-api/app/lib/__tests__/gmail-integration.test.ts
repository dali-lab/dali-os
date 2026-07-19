import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  getSenderRefreshToken,
  getApplicationsGmailRefreshToken,
  isSenderConnected,
} from "~/lib/gmail-integration";

const mockPrisma = prisma as unknown as {
  gmailIntegration: { findFirst: ReturnType<typeof vi.fn> };
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

describe("isSenderConnected", () => {
  it("reports only the purpose's own connection — no fallback", async () => {
    mockPrisma.gmailIntegration.findFirst.mockResolvedValue(null);

    expect(await isSenderConnected("Partners")).toBe(false);
    expect(mockPrisma.gmailIntegration.findFirst).toHaveBeenCalledTimes(1);
  });
});
