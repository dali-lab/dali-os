import { describe, it, expect } from "vitest";
import {
  HISTORY_CAP,
  recordNavigation,
  navigateHistoryStacks,
} from "~/lib/navigation-history";

describe("recordNavigation", () => {
  it("pushes the prior url and clears forward", () => {
    expect(recordNavigation({ backStack: ["/a"], forwardStack: ["/c"] }, "/b", "/d")).toEqual({
      backStack: ["/a", "/b"],
      forwardStack: [],
    });
  });

  it("no-ops when url is unchanged", () => {
    const stacks = { backStack: ["/a"], forwardStack: [] };
    expect(recordNavigation(stacks, "/b", "/b")).toBe(stacks);
  });
});

describe("navigateHistoryStacks", () => {
  it("walks back one step", () => {
    const result = navigateHistoryStacks(
      { backStack: ["/a", "/b"], forwardStack: [] },
      "/c",
      "back",
    );
    expect(result).toEqual({
      stacks: { backStack: ["/a"], forwardStack: ["/c"] },
      target: "/b",
    });
  });

  it("walks forward one step", () => {
    const result = navigateHistoryStacks(
      { backStack: ["/a"], forwardStack: ["/c"] },
      "/b",
      "forward",
    );
    expect(result).toEqual({
      stacks: { backStack: ["/a", "/b"], forwardStack: [] },
      target: "/c",
    });
  });

  it("jumps multiple steps back", () => {
    const result = navigateHistoryStacks(
      { backStack: ["/a", "/b", "/c"], forwardStack: [] },
      "/d",
      "back",
      2,
    );
    expect(result?.target).toBe("/b");
    expect(result?.stacks.backStack).toEqual(["/a"]);
    expect(result?.stacks.forwardStack).toEqual(["/d", "/c"]);
  });

  it("returns null when the stack is too short", () => {
    expect(
      navigateHistoryStacks({ backStack: [], forwardStack: [] }, "/a", "back"),
    ).toBeNull();
  });

  it("caps opposite-stack growth", () => {
    const backStack = Array.from({ length: HISTORY_CAP }, (_, i) => `/p${i}`);
    const result = navigateHistoryStacks(
      { backStack, forwardStack: [] },
      "/current",
      "back",
      HISTORY_CAP,
    );
    expect(result?.stacks.forwardStack.length).toBe(HISTORY_CAP);
  });
});
