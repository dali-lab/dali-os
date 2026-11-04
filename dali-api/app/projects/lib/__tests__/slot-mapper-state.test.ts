import { describe, expect, it } from "vitest";
import { mappingSaveStatus, sameDraftCols } from "../slot-mapper-state";

describe("sameDraftCols", () => {
  it("ignores row ids, which are regenerated after every save", () => {
    expect(sameDraftCols([{ uid: "a", label: "Status" }], [{ uid: "z", label: "Status" }])).toBe(true);
  });

  it("sees a changed column or order", () => {
    expect(sameDraftCols([{ uid: "a", label: "Status" }], [{ uid: "a", label: "State" }])).toBe(false);
    expect(
      sameDraftCols(
        [{ uid: "a", label: "A" }, { uid: "b", label: "B" }],
        [{ uid: "b", label: "B" }, { uid: "a", label: "A" }],
      ),
    ).toBe(false);
  });
});

describe("mappingSaveStatus", () => {
  it("says nothing while saving or before any save", () => {
    expect(mappingSaveStatus({ saving: true, dirty: true, result: undefined })).toBeNull();
    expect(mappingSaveStatus({ saving: false, dirty: false, result: undefined })).toBeNull();
    expect(mappingSaveStatus({ saving: false, dirty: false, result: { error: "Invalid mapping." } })).toBeNull();
  });

  it("flags unsaved edits, even after an earlier save", () => {
    expect(mappingSaveStatus({ saving: false, dirty: true, result: { ok: true } })).toEqual({
      tone: "warn",
      text: "Unsaved changes",
    });
  });

  it("confirms a save, with the response count when the slot re-reads responses", () => {
    expect(mappingSaveStatus({ saving: false, dirty: false, result: { ok: true } })).toEqual({ tone: "ok", text: "Saved" });
    expect(mappingSaveStatus({ saving: false, dirty: false, result: { ok: true, synced: 12, failed: 0 } })).toEqual({
      tone: "ok",
      text: "Saved. 12 responses updated.",
    });
    expect(mappingSaveStatus({ saving: false, dirty: false, result: { ok: true, synced: 1, failed: 0 } })?.text).toBe(
      "Saved. 1 response updated.",
    );
  });

  it("warns when some responses couldn't be read", () => {
    expect(mappingSaveStatus({ saving: false, dirty: false, result: { ok: true, synced: 10, failed: 2 } })).toEqual({
      tone: "warn",
      text: "Saved. 2 responses have statuses the mapping can't read.",
    });
  });
});
