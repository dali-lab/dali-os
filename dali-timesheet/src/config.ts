// Where DALI OS lives. Override at build time with DALI_ORIGIN if you're
// pointing at a local/staging instance; defaults to production.
export const DALI_ORIGIN =
  (globalThis as { DALI_ORIGIN?: string }).DALI_ORIGIN ??
  "https://os.dali.dartmouth.edu";

// The JobX host the content panel attaches to.
export const JOBX_HOST = "dartmouth.studentemployment.ngwebsolutions.com";

// Label shown to the user in DALI's device-approval screen.
export const DEVICE_LABEL = "DALI Timesheet";

// Default look-back window when pulling hours (JobX pay periods are ≤ 2 weeks;
// 30 days comfortably covers the current one plus the tail of the last).
export const DEFAULT_LOOKBACK_DAYS = 30;
