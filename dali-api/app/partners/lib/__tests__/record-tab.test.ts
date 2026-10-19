import { describe, it, expect } from "vitest";
import { initialRecordTab, RECORD_TABS } from "../record-tab";

describe("initialRecordTab", () => {
  it("opens each named tab", () => {
    for (const tab of RECORD_TABS) expect(initialRecordTab(tab)).toBe(tab);
  });

  it("maps the modal's activity link to Overview", () => {
    expect(initialRecordTab("activity")).toBe("overview");
  });

  it("falls back to Overview with no or an unknown tab", () => {
    expect(initialRecordTab(null)).toBe("overview");
    expect(initialRecordTab("")).toBe("overview");
    expect(initialRecordTab("nope")).toBe("overview");
  });
});
