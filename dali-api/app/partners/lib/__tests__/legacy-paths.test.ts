import { describe, it, expect } from "vitest";
import { mapLegacyPartnerPath } from "../legacy-paths";

describe("mapLegacyPartnerPath", () => {
  it("maps the org/contact hub to the directory", () => {
    expect(mapLegacyPartnerPath("/partners")).toBe("/core/partners/directory");
  });

  it("maps the old pipeline page to the board", () => {
    expect(mapLegacyPartnerPath("/partners/applications")).toBe("/core/partners");
  });

  it("maps an application detail page", () => {
    expect(mapLegacyPartnerPath("/partners/applications/abc123")).toBe(
      "/core/partners/applications/abc123",
    );
  });

  it("maps an org detail page", () => {
    expect(mapLegacyPartnerPath("/partners/acme-org")).toBe(
      "/core/partners/orgs/acme-org",
    );
  });

  it("preserves the query string", () => {
    expect(mapLegacyPartnerPath("/partners", "?embed=1")).toBe(
      "/core/partners/directory?embed=1",
    );
    expect(mapLegacyPartnerPath("/partners/acme-org", "?embed=1")).toBe(
      "/core/partners/orgs/acme-org?embed=1",
    );
    expect(mapLegacyPartnerPath("/partners/applications/abc123", "?tab=activity")).toBe(
      "/core/partners/applications/abc123?tab=activity",
    );
  });
});
