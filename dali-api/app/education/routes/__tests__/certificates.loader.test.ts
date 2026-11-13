import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/education/lib/certificates.server", () => ({ getCertificate: vi.fn() }));
vi.mock("~/education/lib/access.server", () => ({ isOfferingManager: vi.fn() }));
vi.mock("~/education/lib/certificate-templates.server", () => ({ getCertificateWebTemplate: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { getCertificate } from "~/education/lib/certificates.server";
import { getCertificateWebTemplate } from "~/education/lib/certificate-templates.server";
import { loader } from "../certificates.$certificateId";

const certificate = {
  id: "c1",
  templateId: "t1",
  applicantUserId: "u1",
  offeringId: "o1",
  studentName: "Ada Lovelace",
  offeringTitle: "Design Basics",
  offeringType: "Miniseries",
  startsAt: null,
  endsAt: null,
  instructorNames: [],
  issuedAt: new Date("2026-10-20T16:00:00Z"),
};

const field = (over: Record<string, unknown>) => ({ key: "studentName", x: 0.1, y: 0.2, w: 0.2, fit: "shrink", fontSize: 60, color: "#000000", align: "left", bold: true, ...over });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(getCertificate).mockResolvedValue(certificate as never);
});

const run = () => loader({ request: new Request("http://x/certificates/c1"), params: { certificateId: "c1" } } as never) as Promise<any>;

describe("certificate page loader", () => {
  it("returns the effective font size for each template field", async () => {
    vi.mocked(getCertificateWebTemplate).mockResolvedValue({
      bgUrl: "https://s3/bg",
      bgWidth: 1000,
      bgHeight: 800,
      fields: [
        field({}),
        field({ key: "offeringTitle", fit: "wrap", fontSize: 40 }),
        { key: "issuedDate", x: 0.5, y: 0.9, fontSize: 18, color: "#000000", align: "center", bold: false },
      ],
    } as never);
    const out = await run();
    expect(out.fieldSizes).toHaveLength(3);
    expect(out.fieldSizes[0]).toBeLessThan(60);
    expect(out.fieldSizes[0]).toBeGreaterThanOrEqual(24);
    expect(out.fieldSizes[1]).toBe(40);
    expect(out.fieldSizes[2]).toBe(18);
    expect(out.templateValues.studentName).toBe("Ada Lovelace");
  });

  it("leaves a shrink field that fits at its set size", async () => {
    vi.mocked(getCertificateWebTemplate).mockResolvedValue({ bgUrl: "u", bgWidth: 1000, bgHeight: 800, fields: [field({ w: 0.9, fontSize: 20 })] } as never);
    expect((await run()).fieldSizes).toEqual([20]);
  });

  it("returns no sizes for a certificate without a template", async () => {
    vi.mocked(getCertificate).mockResolvedValue({ ...certificate, templateId: null } as never);
    const out = await run();
    expect(out.webTemplate).toBeNull();
    expect(out.fieldSizes).toEqual([]);
    expect(out.templateValues).toBeNull();
  });
});
