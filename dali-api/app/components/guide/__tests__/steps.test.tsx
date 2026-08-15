import { describe, expect, it } from "vitest";
import { GUIDE_STEP_VIEWS } from "../steps";
import { GUIDE_STEPS } from "~/lib/guide";

describe("guide step views", () => {
  it("covers every step in the registry, in order", () => {
    expect(GUIDE_STEP_VIEWS.map((v) => v.id)).toEqual(
      GUIDE_STEPS.map((s) => s.id),
    );
  });

  it("gives every gated step a way to satisfy its gate", () => {
    // Without an action a member sits on a disabled Next with nothing to click
    // — the gate becomes a dead end rather than a prompt.
    for (const view of GUIDE_STEP_VIEWS.filter((v) => v.requires)) {
      expect(view.action, `step "${view.id}" has no action`).toBeTruthy();
    }
  });

  it("gives every click-driven step both a target and a match", () => {
    for (const view of GUIDE_STEP_VIEWS) {
      if (view.findTarget) expect(view.matches).toBeTruthy();
      if (view.matches) expect(view.arrived).toBeTruthy();
    }
  });
});
