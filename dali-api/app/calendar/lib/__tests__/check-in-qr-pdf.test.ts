import { describe, expect, it } from "vitest";
import { renderCheckInQrPdf } from "../check-in-qr-pdf.server";

describe("renderCheckInQrPdf", () => {
  it("returns a PDF buffer with a %PDF header", async () => {
    const pdf = await renderCheckInQrPdf({
      meetingTitle: "All-lab Group",
      checkInUrl: "https://example.com/calendar/check-in/abc",
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
