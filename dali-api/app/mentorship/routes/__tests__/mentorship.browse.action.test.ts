import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), currentTerm: vi.fn() }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn() }));
vi.mock("../../lib/term-forms.server", () => ({ loadTermForms: vi.fn(), setTermForm: vi.fn() }));
vi.mock("~/projects/lib/form-slots", () => ({ listSelectableForms: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { setTermForm } from "../../lib/term-forms.server";
import { action } from "../mentorship.browse";

function post(fields: Record<string, string>) {
  return action({
    request: new Request("http://localhost/mentorship/browse", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
  } as any);
}

const LINK = { intent: "link-form", termId: "term1", domainId: "dev", role: "mentee", formId: "f1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core1" } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("mentorship browse action", () => {
  it("links a form for Core", async () => {
    expect(await post(LINK)).toEqual({ ok: true });
    expect(setTermForm).toHaveBeenCalledWith("term1", "dev", "mentee", "f1");
  });

  it("unlinks when the form is cleared", async () => {
    await post({ ...LINK, formId: "" });
    expect(setTermForm).toHaveBeenCalledWith("term1", "dev", "mentee", null);
  });

  it("refuses anyone who isn't Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await post(LINK)) as Response;
    expect(res.status).toBe(403);
    expect(setTermForm).not.toHaveBeenCalled();
  });

  it.each([
    { ...LINK, role: "lead" },
    { ...LINK, termId: "" },
    { ...LINK, domainId: "" },
    { ...LINK, intent: "other" },
  ])("rejects a malformed request (%o)", async (fields) => {
    const res = (await post(fields)) as Response;
    expect(res.status).toBe(400);
    expect(setTermForm).not.toHaveBeenCalled();
  });
});
