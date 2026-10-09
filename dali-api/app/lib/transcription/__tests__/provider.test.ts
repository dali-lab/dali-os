import { describe, it, expect } from "vitest";
import { getTranscriptionProvider, isTranscriptionEnabled } from "~/lib/transcription/provider";

describe("provider/modal module graph", () => {
  it("loads without a circular-import crash, disabled by default", () => {
    expect(isTranscriptionEnabled()).toBe(false);
    expect(getTranscriptionProvider()).toBeNull();
  });

  it("instantiates ModalTranscriptionProvider when configured", () => {
    process.env.DIARIZE_URL = "https://example.modal.run/process";
    process.env.DIARIZE_SECRET = "s3cr3t";
    const provider = getTranscriptionProvider();
    expect(provider).not.toBeNull();
    expect(typeof provider!.process).toBe("function");
    delete process.env.DIARIZE_URL;
    delete process.env.DIARIZE_SECRET;
  });
});
