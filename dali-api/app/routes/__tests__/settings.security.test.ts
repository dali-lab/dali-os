import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/settings-page.server", () => ({}));
vi.mock("~/members/lib/contact-email.server", () => ({
  listContactEmailOptions: vi.fn(),
  runContactEmailIntent: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { listContactEmailOptions, runContactEmailIntent } from "~/members/lib/contact-email.server";
import { action, loader } from "~/routes/settings.security";

const mockAuth = vi.mocked(requireAuth);
const request = (fields?: Record<string, string>) =>
  new Request("http://localhost/settings/security", fields ? { method: "POST", body: new URLSearchParams(fields) } : undefined);

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
});

describe("settings.security loader", () => {
  it("lists the signed-in user's contact email options", async () => {
    const contactEmail = { options: [{ address: "a@b.co", proven: true, current: true }], preselected: "a@b.co" };
    vi.mocked(listContactEmailOptions).mockResolvedValue(contactEmail);
    expect(await loader({ request: request() } as never)).toEqual({ contactEmail });
    expect(listContactEmailOptions).toHaveBeenCalledWith("u1");
  });

  it("returns no options when signed out", async () => {
    mockAuth.mockResolvedValue({ ok: false } as never);
    expect(await loader({ request: request() } as never)).toEqual({ contactEmail: { options: [], preselected: null } });
    expect(listContactEmailOptions).not.toHaveBeenCalled();
  });
});

describe("settings.security action", () => {
  it("runs the contact email intents for the signed-in user", async () => {
    vi.mocked(runContactEmailIntent).mockResolvedValue({ ok: true, status: "switched" });
    expect(await action({ request: request({ intent: "choose-contact-email", address: "a@b.co" }) } as never)).toEqual({
      ok: true,
      status: "switched",
    });
    expect(runContactEmailIntent).toHaveBeenCalledWith("choose-contact-email", expect.any(FormData), "u1", expect.any(Request));
  });

  it("refuses unknown intents and signed-out callers", async () => {
    vi.mocked(runContactEmailIntent).mockResolvedValue(null);
    expect(await action({ request: request({ intent: "nope" }) } as never)).toEqual({ error: "Unknown intent." });
    mockAuth.mockResolvedValue({ ok: false } as never);
    expect(await action({ request: request({ intent: "choose-contact-email" }) } as never)).toEqual({ error: "Not authenticated." });
    expect(runContactEmailIntent).toHaveBeenCalledTimes(1);
  });
});
