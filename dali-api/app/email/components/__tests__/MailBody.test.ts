import { describe, expect, it } from "vitest";
import { frameDoc } from "../MailBody";

describe("frameDoc", () => {
  const darkAware =
    '<style>:root{color-scheme:light dark}@media (prefers-color-scheme: dark){td{color:#fff!important}}</style><table><tr><td>Hi</td></tr></table>';

  it("pins designed mail to the light scheme so it stays readable on the white card", () => {
    const doc = frameDoc(darkAware, false);
    expect(doc).toContain("color-scheme:only light!important");
    expect(doc).not.toMatch(/prefers-color-scheme\s*:\s*dark/i);
    expect(doc).toContain("td{color:#fff!important}");
  });

  it("leaves themed mail untouched", () => {
    expect(frameDoc("<div>Hi</div>", true)).toContain("<body><div>Hi</div></body>");
  });
});
