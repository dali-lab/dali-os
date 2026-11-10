import { describe, expect, it } from "vitest";
import { CORE_TASK_MODAL_FEATURES, resolveTaskModalFeatures } from "~/projects/components/task-modal-features";

describe("resolveTaskModalFeatures", () => {
  it("shows epics and stories by default", () => {
    expect(resolveTaskModalFeatures()).toEqual({ epics: true, stories: true });
    expect(resolveTaskModalFeatures({})).toEqual({ epics: true, stories: true });
  });

  it("lets a caller hide one picker and keep the other", () => {
    expect(resolveTaskModalFeatures({ stories: false })).toEqual({ epics: true, stories: false });
  });

  it("the Core preset hides both pickers", () => {
    expect(resolveTaskModalFeatures(CORE_TASK_MODAL_FEATURES)).toEqual({ epics: false, stories: false });
  });
});
