import { describe, it, expect } from "vitest";
import { coreHandle, coreTrail } from "~/core/coreNav";

describe("coreTrail", () => {
  // The email editor used to hand-roll `breadcrumbTrail: () => [{ label: "Email" }]`
  // because its page lived at an /admin url with no section key in either nav
  // model. That lost the way back to Communications and the switcher with it.
  it("gives the email editor a full Core trail with a section switcher", () => {
    const trail = coreTrail("email", false);
    expect(trail.map((c) => c.label)).toEqual(["Core", "Communications", "Email"]);
    expect(trail[0]?.to).toBe("/core");
    expect(trail[2]?.siblings?.map((s) => s.to)).toEqual([
      "/core/communications/announcements",
      "/core/communications/email",
    ]);
    expect(trail[2]?.siblings?.find((s) => s.current)?.label).toBe("Email");
  });

  it("builds that trail from the route handle too", () => {
    const trail = coreHandle("email").breadcrumbTrail({ isAdmin: false });
    expect(trail.map((c) => c.label)).toEqual(["Core", "Communications", "Email"]);
  });

  // An unknown key yields a lone root crumb, which Breadcrumbs hides — so a
  // typo'd key fails quietly. Worth pinning as the known shape.
  it("falls back to a lone root crumb for an unknown key", () => {
    expect(coreTrail("nope", false)).toEqual([{ label: "Core", to: "/core" }]);
  });

  // A record page (Partner CRM's org/application detail) appends a leaf
  // crumb resolved from its own loader data, so the trail reads
  // "Core › Partner CRM › <record name>" without a per-page breadcrumbTrail.
  it("appends an optional leaf crumb resolved from loader data", () => {
    const handle = coreHandle("partners", (data) => (data as { trailLabel?: string })?.trailLabel);
    const withLabel = handle.breadcrumbTrail({ trailLabel: "Acme Co" });
    expect(withLabel.map((c) => c.label)).toEqual(["Core", "Partner CRM", "Acme Co"]);
    // No `to` on the leaf — it's the current page, not a link.
    expect(withLabel[withLabel.length - 1]?.to).toBeUndefined();

    // A falsy/missing trailLabel (still loading, or no match) leaves the
    // standalone trail as-is rather than appending an empty crumb.
    const withoutLabel = handle.breadcrumbTrail({});
    expect(withoutLabel.map((c) => c.label)).toEqual(["Core", "Partner CRM"]);
  });
});
