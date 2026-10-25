import { describe, expect, it, vi } from "vitest";

vi.mock("~/components/doc", () => ({ DocEditor: () => null }));
vi.mock("../canvas/CanvasBoard", () => ({ CanvasBoard: () => null }));

import { isWorkLocked } from "../StudioLabView";

describe("isWorkLocked", () => {
  it("locks work while it's reviewed and once it's approved", () => {
    expect(isWorkLocked("submitted")).toBe(true);
    expect(isWorkLocked("approved")).toBe(true);
  });

  it("keeps work editable before submitting and after changes are requested", () => {
    expect(isWorkLocked("in-progress")).toBe(false);
    expect(isWorkLocked("changes-requested")).toBe(false);
  });
});
