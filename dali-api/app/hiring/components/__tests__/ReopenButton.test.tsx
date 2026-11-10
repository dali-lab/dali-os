import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReopenButton } from "../ReopenButton";

describe("ReopenButton", () => {
  it("shows Reopen to Core", () => {
    expect(renderToStaticMarkup(<ReopenButton canReopen reopening={false} onReopen={() => {}} />)).toContain("Reopen");
  });

  it("renders nothing for anyone else", () => {
    expect(renderToStaticMarkup(<ReopenButton canReopen={false} reopening={false} onReopen={() => {}} />)).toBe("");
  });
});
