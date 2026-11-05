import { describe, it, expect } from "vitest";
import { parseCaptureReport } from "~/lib/transcription/capture-report";

describe("parseCaptureReport", () => {
  it("keeps the device, permission, and silence fields", () => {
    expect(parseCaptureReport({ micDevice: "MacBook Air Microphone", systemAudioAllowed: false, micSilent: true })).toEqual({
      micDevice: "MacBook Air Microphone",
      systemAudioAllowed: false,
      micSilent: true,
    });
  });

  it("stores an unknown permission as null", () => {
    expect(parseCaptureReport({ systemAudioAllowed: null })).toEqual({ systemAudioAllowed: null });
  });

  it("leaves out fields that weren't sent, so a silence report keeps the stored permission", () => {
    expect(parseCaptureReport({ micSilent: false })).toEqual({ micSilent: false });
  });

  it("trims the device name and caps its length", () => {
    expect(parseCaptureReport({ micDevice: "  USB Mic  " }).micDevice).toBe("USB Mic");
    expect(parseCaptureReport({ micDevice: "x".repeat(200) }).micDevice).toHaveLength(80);
  });

  it("ignores blank and wrongly typed values", () => {
    expect(parseCaptureReport({ micDevice: "  ", systemAudioAllowed: "no", micSilent: 1 })).toEqual({});
    expect(parseCaptureReport({ micDevice: 42 })).toEqual({});
  });

  it("ignores fields outside the report", () => {
    expect(parseCaptureReport({ action: "capture", status: "Done", userId: "u2" })).toEqual({});
  });
});
