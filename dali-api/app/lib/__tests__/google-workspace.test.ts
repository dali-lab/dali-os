import { describe, it, expect } from "vitest";
import { deriveProjectEmails, deriveDaliEmail } from "~/lib/google-workspace";

// These run against the default WORKSPACE_DOMAIN ("dali.dartmouth.edu") since
// GOOGLE_WORKSPACE_DOMAIN is unset in the test env.
const DOMAIN = "dali.dartmouth.edu";

describe("deriveProjectEmails", () => {
  it("slugifies the project name into user + -team group emails", () => {
    expect(deriveProjectEmails("Project Alpha")).toEqual({
      userEmail: `project-alpha@${DOMAIN}`,
      groupEmail: `project-alpha-team@${DOMAIN}`,
    });
  });

  it("collapses punctuation and runs of non-alphanumerics to single hyphens", () => {
    expect(deriveProjectEmails("DALI  OS / 2.0!")).toEqual({
      userEmail: `dali-os-2-0@${DOMAIN}`,
      groupEmail: `dali-os-2-0-team@${DOMAIN}`,
    });
  });

  it("trims leading/trailing hyphens produced by edge punctuation", () => {
    expect(deriveProjectEmails("  -Hello-  ")).toEqual({
      userEmail: `hello@${DOMAIN}`,
      groupEmail: `hello-team@${DOMAIN}`,
    });
  });

  it("falls back to 'project' for an empty/punctuation-only name", () => {
    expect(deriveProjectEmails("!!!")).toEqual({
      userEmail: `project@${DOMAIN}`,
      groupEmail: `project-team@${DOMAIN}`,
    });
  });
});

describe("deriveDaliEmail", () => {
  it("builds first.last with punctuation stripped (unchanged behavior)", () => {
    expect(deriveDaliEmail("Ada", "O'Brien")).toBe(`ada.obrien@${DOMAIN}`);
  });
});
