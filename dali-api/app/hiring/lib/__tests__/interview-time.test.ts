import { describe, it, expect } from "vitest";
import {
  INTERVIEW_TIMEZONE_LABEL,
  formatInterviewDate,
  formatInterviewTime,
  formatInterviewTimeRange,
  formatInterviewTimeRangeDual,
  formatInterviewTimeRangeInZone,
} from "~/hiring/lib/interview-time";

// 2026-03-04T15:00:00Z is 10:00 AM EST (UTC-5) on Wednesday, March 4, 2026.
// Eastern observes EST in March before DST, then EDT after — picking a date
// that is unambiguously *before* the DST transition keeps the assertion
// stable regardless of whether the host runs ICU's tzdata with the 2026 rules.
const ISO_10_AM_ET_PRE_DST = "2026-03-04T15:00:00Z";
const ISO_1030_AM_ET_PRE_DST = "2026-03-04T15:30:00Z";

// 2026-07-15T14:00:00Z is 10:00 AM EDT (UTC-4) — checks DST handling.
const ISO_10_AM_ET_DST = "2026-07-15T14:00:00Z";
const ISO_1030_AM_ET_DST = "2026-07-15T14:30:00Z";

describe("formatInterviewTime", () => {
  it("renders Eastern Time with the ET label, regardless of host timezone", () => {
    expect(formatInterviewTime(ISO_10_AM_ET_PRE_DST)).toBe("10:00 AM ET");
  });

  it("handles DST (EDT) correctly", () => {
    expect(formatInterviewTime(ISO_10_AM_ET_DST)).toBe("10:00 AM ET");
  });

  it("ends with the ET label", () => {
    expect(formatInterviewTime(ISO_10_AM_ET_PRE_DST).endsWith(` ${INTERVIEW_TIMEZONE_LABEL}`)).toBe(true);
  });
});

describe("formatInterviewTimeRange", () => {
  it("renders a start–end range followed by the ET label once", () => {
    expect(formatInterviewTimeRange(ISO_10_AM_ET_PRE_DST, ISO_1030_AM_ET_PRE_DST)).toBe(
      "10:00 AM - 10:30 AM ET",
    );
  });

  it("respects the separator argument", () => {
    expect(
      formatInterviewTimeRange(ISO_10_AM_ET_DST, ISO_1030_AM_ET_DST, " – "),
    ).toBe("10:00 AM – 10:30 AM ET");
  });
});

// The zoned formatters name the zone rather than abbreviating it, so an
// interviewer or applicant outside the US reads "India Time" instead of the
// "GMT+5:30" that the abbreviation style produces for every non-US zone.
describe("formatInterviewTimeRangeInZone", () => {
  it("labels a US zone generically, with no daylight/standard distinction", () => {
    expect(
      formatInterviewTimeRangeInZone(
        ISO_10_AM_ET_DST,
        ISO_1030_AM_ET_DST,
        "America/New_York",
      ),
    ).toBe("10:00 AM - 10:30 AM ET");
  });

  it("names a non-US zone instead of printing an offset", () => {
    const text = formatInterviewTimeRangeInZone(
      ISO_10_AM_ET_DST,
      ISO_1030_AM_ET_DST,
      "Asia/Kolkata",
    );
    expect(text).toBe("7:30 PM - 8:00 PM India Time");
    expect(text).not.toMatch(/GMT[+-]/);
  });
});

describe("formatInterviewTimeRangeDual", () => {
  it("keeps the ET anchor and adds the applicant's own clock", () => {
    expect(
      formatInterviewTimeRangeDual(
        ISO_10_AM_ET_DST,
        ISO_1030_AM_ET_DST,
        "America/Los_Angeles",
      ),
    ).toBe("10:00 AM - 10:30 AM ET · 7:00 AM - 7:30 AM your time (PT)");
  });

  it("names a remote applicant's zone instead of printing an offset", () => {
    const text = formatInterviewTimeRangeDual(
      ISO_10_AM_ET_DST,
      ISO_1030_AM_ET_DST,
      "Asia/Kolkata",
    );
    expect(text).toBe(
      "10:00 AM - 10:30 AM ET · 7:30 PM - 8:00 PM your time (India Time)",
    );
    expect(text).not.toMatch(/GMT[+-]/);
  });

  it("collapses to the ET range when the applicant's zone is unknown or Eastern", () => {
    for (const tz of [null, undefined, "garbage", "America/New_York"]) {
      expect(formatInterviewTimeRangeDual(ISO_10_AM_ET_DST, ISO_1030_AM_ET_DST, tz)).toBe(
        "10:00 AM - 10:30 AM ET",
      );
    }
  });

  // Toronto is a different zone that reads identically to ET, so repeating it
  // would add nothing. The generic label has to preserve this collapse.
  it("collapses a different zone that reads identically to Eastern", () => {
    expect(
      formatInterviewTimeRangeDual(ISO_10_AM_ET_DST, ISO_1030_AM_ET_DST, "America/Toronto"),
    ).toBe("10:00 AM - 10:30 AM ET");
  });
});

describe("formatInterviewDate", () => {
  it("formats the date in Eastern Time", () => {
    expect(formatInterviewDate(ISO_10_AM_ET_PRE_DST)).toBe("Wednesday, March 4");
  });

  it("uses the ET calendar day even when the UTC instant falls on the next day", () => {
    // 2026-03-05T03:30:00Z is 10:30 PM ET on March 4 (Wednesday) — a host
    // running in UTC would otherwise label this "Thursday, March 5".
    expect(formatInterviewDate("2026-03-05T03:30:00Z")).toBe("Wednesday, March 4");
  });
});
