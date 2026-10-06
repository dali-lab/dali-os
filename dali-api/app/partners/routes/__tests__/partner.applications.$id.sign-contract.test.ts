import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/partners/lib/partner-auth.server", () => ({ requirePartnerAccount: vi.fn() }));
vi.mock("~/partners/lib/partner-contract.server", () => ({
  partnerContractStatus: vi.fn(),
  resolvePartnerContractVariables: vi.fn().mockResolvedValue({}),
  onPartnerContractSigned: vi.fn(),
}));
vi.mock("~/signing/lib/sign.server", () => ({ recordSignature: vi.fn() }));

import { prisma } from "~/lib/db";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { loader, action } from "~/partners/routes/partner.applications.$id.sign-contract";

const db = prisma as unknown as Record<string, any>;
const APP_ID = "app-1";

function req(method: "GET" | "POST" = "GET", body?: FormData) {
  return new Request(`http://localhost/partner/applications/${APP_ID}/sign-contract`, {
    method,
    ...(body ? { body } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (requirePartnerAccount as any).mockResolvedValue({
    auth: { user: { sub: "user-1" } },
    contact: { id: "contact-1", name: "Ada", email: "ada@acme.com", userId: "user-1" },
    memberships: [],
  });
});

describe("partner sign-contract loader", () => {
  it("404s when the application belongs to a different contact", async () => {
    // Scoped lookup: findFirst filters by applicantContactId, so a wrong-
    // contact request simply finds nothing — never a 403 that would leak
    // the application's existence.
    db.partnerApplication.findFirst.mockResolvedValue(null);

    await expect(loader({ request: req(), params: { id: APP_ID }, context: {} } as any)).rejects.toMatchObject({
      status: 404,
    });
    expect(db.partnerApplication.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: APP_ID, applicantContactId: "contact-1" },
      }),
    );
  });

  it("404s when no contract has been sent yet", async () => {
    db.partnerApplication.findFirst.mockResolvedValue({
      id: APP_ID,
      title: "Gallery Kiosk",
      contractBindingId: null,
    });

    await expect(loader({ request: req(), params: { id: APP_ID }, context: {} } as any)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("renders the fill view when a contract is sent but not yet signed", async () => {
    db.partnerApplication.findFirst.mockResolvedValue({
      id: APP_ID,
      title: "Gallery Kiosk",
      contractBindingId: "binding-1",
    });
    db.signingBinding.findUnique.mockResolvedValue({
      id: "binding-1",
      versionId: "ver-1",
      version: { body: [] },
      signatures: [],
    });

    const data = await loader({ request: req(), params: { id: APP_ID }, context: {} } as any);
    expect(data).toMatchObject({ applicationId: APP_ID, bindingId: "binding-1", signed: false });
  });

  it("marks signed once the member-role signature matches the in-force version", async () => {
    db.partnerApplication.findFirst.mockResolvedValue({
      id: APP_ID,
      title: "Gallery Kiosk",
      contractBindingId: "binding-1",
    });
    db.signingBinding.findUnique.mockResolvedValue({
      id: "binding-1",
      versionId: "ver-1",
      version: { body: [] },
      signatures: [{ versionId: "ver-1" }],
    });

    const data = await loader({ request: req(), params: { id: APP_ID }, context: {} } as any);
    expect(data.signed).toBe(true);
  });
});

describe("partner sign-contract action", () => {
  it("404s when the application belongs to a different contact", async () => {
    db.partnerApplication.findFirst.mockResolvedValue(null);
    const fd = new FormData();
    fd.set("intent", "sign");

    await expect(
      action({ request: req("POST", fd), params: { id: APP_ID }, context: {} } as any),
    ).rejects.toMatchObject({ status: 404 });
  });
});
