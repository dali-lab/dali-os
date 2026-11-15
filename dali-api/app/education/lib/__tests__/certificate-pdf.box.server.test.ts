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
  templateFieldSizes,
  type CertificateData,
  type CertificateTemplateRender,
} from "~/education/lib/certificate-pdf.server";

const cert: CertificateData = {
  studentName: "Ada Lovelace",
  offeringTitle: "Design Basics",
  offeringType: "Miniseries",
  startsAt: new Date("2026-09-01T16:00:00Z"),
  endsAt: new Date("2026-10-15T16:00:00Z"),
  instructorNames: ["Grace Hopper"],
  issuedAt: new Date("2026-10-20T16:00:00Z"),
};

const texts = () =>
  h.state.calls.filter((c) => c.op === "text").map((c) => c.args as [string, number, number, any]);
const sizes = () => h.state.calls.filter((c) => c.op === "fontSize").map((c) => c.args[0]);

beforeEach(() => {
  h.state.calls = [];
  h.state.ctorArgs = [];
  h.state.widthPerChar = 10;
});

const box = (over: Record<string, unknown>) => ({
  key: "studentName",
  x: 0.1,
  y: 0.25,
  w: 0.5,
  fontSize: 30,
  color: "#112233",
  align: "center",
  bold: false,
  fit: "wrap",
  ...over,
});
const template = (fields: unknown[]): CertificateTemplateRender => ({
  bgWidth: 1000,
  bgHeight: 800,
  background: Buffer.from("png"),
  fields: fields as never,
});

describe("box fields", () => {
  it("draws wrapped text inside the box with its align and a height that stops at the page bottom", async () => {
    await renderCertificatePdf(cert, template([box({})]));
    expect(texts()).toEqual([["Ada Lovelace", 100, 200, { width: 500, align: "center", height: 600 }]]);
    expect(sizes()).toContain(30);
  });

  it("keeps the set size for a wrap field however long the text", async () => {
    h.state.widthPerChar = 100;
    await renderCertificatePdf(cert, template([box({})]));
    expect(sizes().at(-1)).toBe(30);
  });

  it("shrinks a shrink field to fit one line", async () => {
    h.state.widthPerChar = 100;
    await renderCertificatePdf(cert, template([box({ fit: "shrink" })]));
    expect(sizes().at(-1)).toBeCloseTo((30 * 500) / 1200);
  });

  it("does not shrink a shrink field that already fits", async () => {
    await renderCertificatePdf(cert, template([box({ fit: "shrink" })]));
    expect(sizes().at(-1)).toBe(30);
  });

  it("stops shrinking at 40 percent and wraps from there", async () => {
    h.state.widthPerChar = 1000;
    await renderCertificatePdf(cert, template([box({ fit: "shrink" })]));
    expect(sizes().at(-1)).toBeCloseTo(12);
    expect(texts()[0][3].width).toBe(500);
  });

  it("skips empty values", async () => {
    await renderCertificatePdf({ ...cert, endsAt: null }, template([box({ key: "dateRange" })]));
    expect(texts()).toEqual([]);
  });
});

describe("legacy anchor fields", () => {
  it("still anchor by align with no wrapping, and stop at the page bottom", async () => {
    await renderCertificatePdf(cert, template([{ key: "studentName", x: 0.5, y: 0.98, fontSize: 30, color: "#000000", align: "center", bold: false }]));
    expect(texts()).toEqual([["Ada Lovelace", 440, 784, { lineBreak: false, height: 16 }]]);
  });
});

describe("templateFieldSizes", () => {
  const values = { studentName: "Ada Lovelace", offeringTitle: "", dateRange: "", instructors: "", issuedDate: "" };

  it("returns the effective size per field, in order", () => {
    h.state.widthPerChar = 100;
    const out = templateFieldSizes(
      [box({ fit: "shrink" }), box({ key: "offeringTitle", fontSize: 22 }), { key: "studentName", x: 0.5, y: 0.5, fontSize: 18, color: "#000", align: "center", bold: false }] as never,
      values,
      1000,
    );
    expect(out[0]).toBeCloseTo((30 * 500) / 1200);
    expect(out[1]).toBe(22);
    expect(out[2]).toBe(18);
  });
});
