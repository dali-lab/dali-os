import { describe, expect, it } from "vitest";
import { impersonateErrorMessage } from "~/admin/lib/impersonate-error";

describe("impersonateErrorMessage", () => {
  it.each([
    ["missing", "That user no longer exists."],
    ["self", "You can't log in as yourself."],
    ["failed", "Couldn't log in as that user. Try again."],
  ])("names the %s failure", (code, message) => {
    expect(impersonateErrorMessage(code)).toBe(message);
  });

  it.each([null, "", "toString", "<script>"])("ignores %s", (code) => {
    expect(impersonateErrorMessage(code)).toBeNull();
  });
});
