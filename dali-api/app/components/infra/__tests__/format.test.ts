import { describe, expect, it } from "vitest";
import { consoleUrl, INFRA_COLS, plural, volumeSummary } from "../format";

describe("consoleUrl", () => {
  it("links a Fly app and machine", () => {
    expect(consoleUrl.flyApp("dali-api-pr-1375")).toBe("https://fly.io/apps/dali-api-pr-1375");
    expect(consoleUrl.flyMachine("dali-api-pr-1375", "e784")).toBe("https://fly.io/apps/dali-api-pr-1375/machines/e784");
  });

  it("links a Neon org and database", () => {
    expect(consoleUrl.neonOrg("org-dali-1")).toBe("https://console.neon.tech/app/org-dali-1");
    expect(consoleUrl.neonProject("silent-pine-123")).toBe("https://console.neon.tech/app/projects/silent-pine-123");
  });

  it("links Vaultwarden pages off the org", () => {
    const org = "https://vault.example.edu/#/organizations/org-1";
    expect(consoleUrl.vaultMembers(org)).toBe(`${org}/members`);
    expect(consoleUrl.vaultGroups(org)).toBe(`${org}/groups`);
    expect(consoleUrl.vaultCollection(org, "c 1")).toBe(`${org}/vault?collectionId=c%201`);
  });

  it("escapes path segments", () => {
    expect(consoleUrl.flyApp("a/b")).toBe("https://fly.io/apps/a%2Fb");
  });
});

describe("plural", () => {
  it("uses the singular for exactly one", () => {
    expect(plural(1, "machine")).toBe("1 machine");
    expect(plural(0, "machine")).toBe("0 machines");
    expect(plural(3, "branch", "branches")).toBe("3 branches");
  });
});

describe("volumeSummary", () => {
  it("totals volume size", () => {
    expect(volumeSummary([{ sizeGb: 1 }, { sizeGb: 3 }])).toBe("2 volumes (4 GB)");
    expect(volumeSummary([{ sizeGb: 1 }])).toBe("1 volume (1 GB)");
    expect(volumeSummary([])).toBe("0 volumes");
  });
});

describe("INFRA_COLS", () => {
  it("leaves only the name column flexible so stacked tables line up", () => {
    for (const widths of Object.values(INFRA_COLS)) {
      expect(widths[0]).toBeNull();
      expect(widths.slice(1).every((w) => typeof w === "string")).toBe(true);
    }
  });
});
