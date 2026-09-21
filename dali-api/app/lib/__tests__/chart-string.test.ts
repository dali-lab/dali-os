import { describe, it, expect } from "vitest";
import {
  parseChartString,
  normalizeChartString,
  isValidChartString,
  GL_SUBACTIVITIES,
  DALI_ORG,
} from "~/lib/chart-string";

// Every literal below is a real value: from the FY23-FY27 GL export, from
// TimesheetEntry rows in production, or from a RAPPORT award email.

describe("normalizeChartString", () => {
  it("trims and upper-cases", () => {
    expect(normalizeChartString("  521765.5000.b04373.xxxxx.330 ")).toBe(
      "521765.5000.B04373.XXXXX.330",
    );
  });

  it("strips an autolink scheme without claiming to have fixed the value", () => {
    // The dot between 522693 and 5000 is gone; stripping tel: cannot restore it.
    expect(normalizeChartString("tel:5226935000.B04560.xxxxx.722")).toBe(
      "5226935000.B04560.XXXXX.722",
    );
  });
});

describe("GL strings", () => {
  it("parses the lab's own projects string", () => {
    const r = parseChartString("20.330.161028.128512.4000", "GL");
    expect(r.errors).toEqual([]);
    expect(r.type).toBe("GL");
    expect(r.org).toBe("330");
    expect(r.projectCode).toBe("128512"); // Activity — the join key
    expect(r.subactivity).toBe("4000");
    expect(r.natclass).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it("accepts a sixth natclass segment", () => {
    const r = parseChartString("20.722.161028.128512.4000.6251");
    expect(r.errors).toEqual([]);
    expect(r.natclass).toBe("6251");
    expect(r.projectCode).toBe("128512");
  });

  it("warns on the pre-migration org rather than rejecting", () => {
    const r = parseChartString("18.722.161028.128512.4000", "GL");
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain("org_not_current");
  });

  it("rejects a placeholder subactivity — GL subactivity names the work", () => {
    const r = parseChartString("20.330.161028.128512.XXXX", "GL");
    expect(r.errors.map((e) => e.code)).toContain("gl_subactivity_placeholder");
  });

  it("warns, but does not reject, an unknown subactivity code", () => {
    // DALI is taking control of more of this segment; the list will grow.
    const r = parseChartString("20.330.161028.128512.7777", "GL");
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain("gl_subactivity_unknown");
  });

  it("knows the six documented subactivity codes", () => {
    expect(Object.keys(GL_SUBACTIVITIES).sort()).toEqual([
      "0000",
      "1500",
      "2000",
      "3000",
      "4000",
      "5000",
    ]);
    expect(GL_SUBACTIVITIES["4000"]).toBe("Projects");
  });
});

describe("PTAEO strings", () => {
  it("parses an advance account with its XXXXX expenditure type", () => {
    // FP00014787, DALI - Ultrasound Education.
    const r = parseChartString("523241.5000.B04662.XXXXX.330", "PTAEO");
    expect(r.errors).toEqual([]);
    expect(r.type).toBe("PTAEO");
    expect(r.projectCode).toBe("523241"); // Project — the join key
    expect(r.awardCode).toBe("B04662");
    expect(r.org).toBe(DALI_ORG);
    expect(r.warnings).toEqual([]);
  });

  it("gives a stored wildcard and a posted expense the same projectCode", () => {
    // This is the whole attribution mechanism: Link VT stored with XXXXX, the
    // expense posted with 6262A, both reduce to 521765.
    const stored = parseChartString("521765.5000.B04373.XXXXX.330");
    const posted = parseChartString("521765.5000.B04373.6262A.330");
    expect(stored.errors).toEqual([]);
    expect(posted.errors).toEqual([]);
    expect(stored.projectCode).toBe(posted.projectCode);
    expect(stored.projectCode).toBe("521765");
  });

  it("rejects a placeholder outside the expenditure type", () => {
    const r = parseChartString("XXXXXX.5000.B04373.6262A.330");
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("warns when the task falls outside the documented ranges", () => {
    const r = parseChartString("522467.9000.C00301.XXXXX.480");
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain("ptaeo_task_range");
  });

  it("accepts a 6000-range internal cost share task", () => {
    const r = parseChartString("522467.6000.C00301.XXXXX.480");
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).not.toContain("ptaeo_task_range");
  });

  it("rejects a truncated three-segment string", () => {
    // Satellite Orbit Game is stored like this in production today.
    const r = parseChartString("521553.5000.B04326", "PTAEO");
    expect(r.errors.map((e) => e.code)).toContain("ptaeo_shape");
  });
});

describe("the corrupt production value", () => {
  it("is rejected rather than silently repaired", () => {
    const r = parseChartString("tel:5226935000.B04560.xxxxx.722", "GL");
    expect(r.errors.map((e) => e.code)).toContain("uri_scheme");
    expect(isValidChartString("tel:5226935000.B04560.xxxxx.722")).toBe(false);
  });
});

describe("type declaration", () => {
  it("warns when the declared type disagrees with the shape", () => {
    // Custom Tours is stored as GL in production but is plainly a PTAEO.
    const r = parseChartString("522693.5000.B04560.XXXXX.722", "GL");
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain("type_mismatch");
    expect(r.type).toBe("PTAEO");
  });
});

describe("rejections", () => {
  it.each([
    ["", "empty"],
    ["not a chart string", "unrecognized"],
    ["20.330.161028.128512", "gl_shape"],
    ["521765.5000.B04373.XXXXX", "ptaeo_shape"],
  ])("rejects %j", (input, code) => {
    expect(parseChartString(input).errors.map((e) => e.code)).toContain(code);
  });
});
