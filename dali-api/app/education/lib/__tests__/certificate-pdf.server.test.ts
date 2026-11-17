import { describe, it, expect, beforeEach, vi } from "vitest";

// A recording stand-in for pdfkit: tests assert on what gets drawn, not on PDF bytes.
const h = vi.hoisted(() => {
  type Call = { op: string; args: unknown[] };
  const state = { calls: [] as Call[], ctorArgs: [] as unknown[], widthPerChar: 10 };
  class FakePDF {
    page = { width: 792, height: 612 };
    private handlers: Record<string, (arg?: unknown) => void> = {};
    constructor(opts: unknown) {
      state.ctorArgs.push(opts);
    }
    on(evt: string, fn: (arg?: unknown) => void) {
      this.handlers[evt] = fn;
      return this;
    }
    end() {
      this.handlers.data?.(Buffer.from("%PDF"));
      this.handlers.end?.();
    }
    widthOfString(s: string) {
      return s.length * state.widthPerChar;
    }
  }
  for (const op of ["image", "font", "fontSize", "fillColor", "text", "rect", "lineWidth", "stroke"]) {
    (FakePDF.prototype as any)[op] = function (...args: unknown[]) {
      state.calls.push({ op, args });
      return this;
    };
  }
  return { state, FakePDF };
});
vi.mock("pdfkit", () => ({ default: h.FakePDF }));

import {
  renderCertificatePdf,
  type CertificateData,
  type CertificateTemplateRender,
} from "~/education/lib/certificate-pdf.server";

const cert: CertificateData = {
  studentName: "Ada Lovelace",
  offeringTitle: "Design Basics",
  offeringType: "Miniseries",
  startsAt: new Date("2026-09-01T16:00:00Z"),
  endsAt: new Date("2026-10-15T16:00:00Z"),
  instructorNames: ["Grace Hopper", "Alan Turing"],
  issuedAt: new Date("2026-10-20T16:00:00Z"),
};

const texts = () =>
  h.state.calls.filter((c) => c.op === "text").map((c) => c.args as [string, number, number, any]);

beforeEach(() => {
  h.state.calls = [];
  h.state.ctorArgs = [];
  h.state.widthPerChar = 10;
});

describe("built-in design", () => {
  it("renders a landscape LETTER page and resolves to the document bytes", async () => {
    const out = await renderCertificatePdf(cert);
    expect(out.toString()).toBe("%PDF");
    expect(h.state.ctorArgs[0]).toEqual({ size: "LETTER", layout: "landscape", margin: 0 });
  });

  it("prints the student, course, lower-cased type, date range, instructors and issue date", async () => {
    await renderCertificatePdf(cert);
    const lines = texts().map((t) => t[0]);
    expect(lines).toContain("Ada Lovelace");
    expect(lines).toContain("Design Basics");
    expect(lines).toContain("completed the miniseries");
    expect(lines).toContain("Sep 1, 2026 – Oct 15, 2026");
    expect(lines).toContain("Taught by Grace Hopper, Alan Turing");
    expect(lines).toContain("Issued Oct 20, 2026");
  });

  it("says 'Date TBD' unless both dates are set", async () => {
    await renderCertificatePdf({ ...cert, endsAt: null });
    expect(texts().map((t) => t[0])).toContain("Date TBD");
    h.state.calls = [];
    await renderCertificatePdf({ ...cert, startsAt: null });
    expect(texts().map((t) => t[0])).toContain("Date TBD");
  });

  it("omits the 'Taught by' line with no instructors", async () => {
    await renderCertificatePdf({ ...cert, instructorNames: [] });
    expect(texts().some((t) => t[0].startsWith("Taught by"))).toBe(false);
  });

  it("does not take the template path when template is null", async () => {
    await renderCertificatePdf(cert, null);
    expect(h.state.calls.some((c) => c.op === "image")).toBe(false);
  });
});

describe("template design", () => {
  const field = (over: Record<string, unknown>) => ({
    key: "studentName",
    x: 0.5,
    y: 0.25,
    fontSize: 30,
    color: "#112233",
    align: "left",
    bold: false,
    ...over,
  });
  const template = (fields: unknown[]): CertificateTemplateRender => ({
    bgWidth: 1000,
    bgHeight: 800,
    background: Buffer.from("png"),
    fields: fields as never,
  });

  it("sizes the page to the background and draws it full-bleed first", async () => {
    const bg = Buffer.from("png");
    await renderCertificatePdf(cert, { ...template([]), background: bg });
    expect(h.state.ctorArgs[0]).toEqual({ size: [1000, 800], margin: 0 });
    expect(h.state.calls[0]).toEqual({ op: "image", args: [bg, 0, 0, { width: 1000, height: 800 }] });
  });

  it("anchors left-aligned text at the fractional position and styles it", async () => {
    await renderCertificatePdf(cert, template([field({})]));
    expect(texts()).toEqual([["Ada Lovelace", 500, 200, { lineBreak: false, height: 600 }]]);
    expect(h.state.calls).toContainEqual({ op: "fontSize", args: [30] });
    expect(h.state.calls).toContainEqual({ op: "fillColor", args: ["#112233"] });
    expect(h.state.calls).toContainEqual({ op: "font", args: ["Helvetica"] });
  });

  it("centres and right-aligns around the anchor using measured text width", async () => {
    // "Ada Lovelace" = 12 chars * 10 = 120
    await renderCertificatePdf(cert, template([field({ align: "center" }), field({ align: "right" })]));
    const xs = texts().map((t) => t[1]);
    expect(xs).toEqual([500 - 60, 500 - 120]);
  });

  it("uses bold Helvetica for bold fields", async () => {
    await renderCertificatePdf(cert, template([field({ bold: true })]));
    expect(h.state.calls).toContainEqual({ op: "font", args: ["Helvetica-Bold"] });
  });

  it("fills each key with the right value, and the date range is empty without both dates", async () => {
    await renderCertificatePdf(
      cert,
      template([
        field({ key: "offeringTitle" }),
        field({ key: "dateRange" }),
        field({ key: "instructors" }),
        field({ key: "issuedDate" }),
      ]),
    );
    expect(texts().map((t) => t[0])).toEqual([
      "Design Basics",
      "Sep 1, 2026 – Oct 15, 2026",
      "Grace Hopper, Alan Turing",
      "Oct 20, 2026",
    ]);

    h.state.calls = [];
    await renderCertificatePdf({ ...cert, endsAt: null }, template([field({ key: "dateRange" }), field({})]));
    // The empty dateRange is skipped rather than drawn as a blank string.
    expect(texts().map((t) => t[0])).toEqual(["Ada Lovelace"]);
  });
});
