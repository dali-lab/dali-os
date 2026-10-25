import { describe, it, expect } from "vitest";
import { coreHandle, coreTrail } from "~/core/coreNav";

describe("coreTrail", () => {
  it("gives a Communications tool a full Core trail with a section switcher", () => {
    const trail = coreTrail("email", false);
    expect(trail.map((c) => c.label)).toEqual(["Core", "Communications", "Email templates"]);
    expect(trail[0]?.to).toBe("/core");
    expect(trail[2]?.siblings?.map((s) => s.to)).toEqual([
      "/core/communications/announcements",
      "/core/communications/listserv",
      "/core/communications/banners",
      "/core/communications/release-notes",
      "/core/communications/email",
    ]);
    expect(trail[2]?.siblings?.find((s) => s.current)?.label).toBe("Email templates");
  });

  // The Communications pages share one tab strip, so their trail stops at the
  // cluster rather than repeating the tab's name.
  it("stops the Communications pages' trail at the cluster", () => {
    const trail = coreHandle("communications").breadcrumbTrail({ isAdmin: false });
    expect(trail.map((c) => c.label)).toEqual(["Core", "Communications"]);
  });

  it("gives Roles & domains a flat Core trail", () => {
    expect(coreTrail("access", false)).toEqual([{ label: "Core", to: "/core" }, { label: "Roles & domains" }]);
  });

  // An unknown key yields a lone root crumb, which Breadcrumbs hides — so a
  // typo'd key fails quietly. Worth pinning as the known shape.
  it("falls back to a lone root crumb for an unknown key", () => {
    expect(coreTrail("nope", false)).toEqual([{ label: "Core", to: "/core" }]);
  });

  // A record page (Partner CRM's org/application detail) appends a leaf
  // crumb resolved from its own loader data, so the trail reads
  // "Core › Partners › <record name>" without a per-page breadcrumbTrail.
  it("appends an optional leaf crumb resolved from loader data", () => {
    const handle = coreHandle("partners", (data) => (data as { trailLabel?: string })?.trailLabel);
    const withLabel = handle.breadcrumbTrail({ trailLabel: "Acme Co" });
    expect(withLabel.map((c) => c.label)).toEqual(["Core", "Partners", "Acme Co"]);
    // No `to` on the leaf — it's the current page, not a link.
    expect(withLabel[withLabel.length - 1]?.to).toBeUndefined();

    // A falsy/missing trailLabel (still loading, or no match) leaves the
    // standalone trail as-is rather than appending an empty crumb.
    const withoutLabel = handle.breadcrumbTrail({});
    expect(withoutLabel.map((c) => c.label)).toEqual(["Core", "Partners"]);
  });
});
