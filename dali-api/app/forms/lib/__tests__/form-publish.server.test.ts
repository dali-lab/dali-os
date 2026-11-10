import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { setFormPublished } from "~/forms/lib/form-publish.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

function existing(opts: { publicToken: string | null; versions: number }) {
  mockPrisma.form.findUnique.mockResolvedValue({
    publicToken: opts.publicToken,
    _count: { versions: opts.versions },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("setFormPublished", () => {
  it("mints a link token on first publish", async () => {
    existing({ publicToken: null, versions: 1 });

    expect(await setFormPublished("f1", true)).toEqual({ ok: true });

    const data = mockPrisma.form.update.mock.calls[0][0].data;
    expect(data.published).toBe(true);
    expect(data.publicToken).toMatch(/^[0-9a-f]{48}$/);
  });

  it("keeps the existing token on re-publish so shared links still work", async () => {
    existing({ publicToken: "tok", versions: 1 });

    await setFormPublished("f1", true);

    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { published: true, publicToken: "tok" },
    });
  });

  it("unpublishes without touching the token", async () => {
    existing({ publicToken: "tok", versions: 1 });

    await setFormPublished("f1", false);

    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { published: false },
    });
  });

  it("refuses to publish a form with no versions", async () => {
    existing({ publicToken: null, versions: 0 });

    const result = await setFormPublished("f1", true);

    expect(result).toMatchObject({ status: 400 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });

  it("still unpublishes a form with no versions", async () => {
    existing({ publicToken: "tok", versions: 0 });

    expect(await setFormPublished("f1", false)).toEqual({ ok: true });
  });

  it("404s an unknown form", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);

    expect(await setFormPublished("gone", true)).toMatchObject({ status: 404 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "clears the schedule when asked (published=%s), so a hidden window can't flip it later",
    async (published) => {
      existing({ publicToken: "tok", versions: 1 });

      await setFormPublished("f1", published, { clearWindow: true });

      expect(mockPrisma.form.update.mock.calls[0][0].data).toMatchObject({
        published,
        opensAt: null,
        closesAt: null,
      });
    },
  );

  it("leaves the schedule alone by default", async () => {
    existing({ publicToken: "tok", versions: 1 });

    await setFormPublished("f1", true);

    const data = mockPrisma.form.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("opensAt");
    expect(data).not.toHaveProperty("closesAt");
  });
});
