import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isPartnerAccount: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/slide-pdf.server", () => ({ exportDeckPdf: vi.fn() }));

import { isNonMember, isPartnerAccount, requireAuth } from "~/lib/auth";
import { exportDeckPdf } from "~/lib/slide-pdf.server";
import { loader } from "~/routes/slides.$pageId.export-pdf";

const get = (query = "") =>
  loader({ request: new Request(`http://localhost/slides/p1/export.pdf${query}`), params: { pageId: "p1" }, context: {} } as never) as Promise<Response>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(isPartnerAccount).mockResolvedValue(false as never);
  vi.mocked(exportDeckPdf).mockResolvedValue({ ok: true, pdf: Buffer.from("%PDF"), filename: "Deck.pdf" });
});

describe("slides export.pdf", () => {
  it("returns the PDF as an attachment", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="Deck.pdf"');
    expect(exportDeckPdf).toHaveBeenCalledWith("u1", "p1", { notes: false }, expect.any(Request));
  });

  it("passes notes=1 through and nothing else", async () => {
    await get("?notes=1");
    expect(exportDeckPdf).toHaveBeenLastCalledWith("u1", "p1", { notes: true }, expect.any(Request));
    await get("?notes=yes");
    expect(exportDeckPdf).toHaveBeenLastCalledWith("u1", "p1", { notes: false }, expect.any(Request));
  });

  it("answers a stranger with the export's 404", async () => {
    vi.mocked(exportDeckPdf).mockResolvedValue({ ok: false, status: 404, error: "Slide deck not found." });
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Slide deck not found.");
  });

  it("rejects signed-out, non-member and partner callers", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ ok: false } as never);
    expect((await get()).status).toBe(401);
    vi.mocked(isNonMember).mockResolvedValueOnce(true);
    expect((await get()).status).toBe(403);
    vi.mocked(isPartnerAccount).mockResolvedValueOnce(true as never);
    expect((await get()).status).toBe(403);
    expect(exportDeckPdf).not.toHaveBeenCalled();
  });
});
