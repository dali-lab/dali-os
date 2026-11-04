export type CaptureReport = {
  micDevice?: string;
  systemAudioAllowed?: boolean | null;
  micSilent?: boolean;
};

/** The fields a desktop `capture` report may set; anything else is ignored. */
export function parseCaptureReport(body: Record<string, unknown>): CaptureReport {
  const report: CaptureReport = {};
  if (typeof body.micDevice === "string" && body.micDevice.trim()) {
    report.micDevice = body.micDevice.trim().slice(0, 80);
  }
  if (typeof body.systemAudioAllowed === "boolean" || body.systemAudioAllowed === null) {
    report.systemAudioAllowed = body.systemAudioAllowed;
  }
  if (typeof body.micSilent === "boolean") report.micSilent = body.micSilent;
  return report;
}
