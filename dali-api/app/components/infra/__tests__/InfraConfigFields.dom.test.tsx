// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InfraConfigFields, withOwnOrg, type InfraConfigValues } from "../InfraConfigFields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const knownOrgs = {
  fly: [{ orgId: "dali-os", resources: [{ id: "web", name: "web" }, { id: "ultrasound", name: "ultrasound" }] }],
  neon: [{ orgId: "org-dali-1", resources: [{ id: "np-a", name: "Alpha" }] }],
};
const blank: InfraConfigValues = {
  flyOrgSlug: null,
  flyAppNames: [],
  neonOrgId: null,
  neonProjectIds: [],
  vaultwardenGroupId: null,
  infraEnabled: true,
  hasFlyReadToken: false,
  hasFlyWriteToken: false,
};

let root: Root | null = null;
let container: HTMLFormElement;
function render(config: InfraConfigValues, vaultGroups: { id: string; name: string }[] | null = null) {
  container = document.createElement("form");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(InfraConfigFields, { config, knownOrgs: { ...knownOrgs, vaultGroups } })));
}
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const values = (name: string) => new FormData(container).getAll(name);

describe("InfraConfigFields", () => {
  it("posts the saved orgs and linked apps and databases", () => {
    render({ ...blank, flyOrgSlug: "dali-os", flyAppNames: ["ultrasound"], neonOrgId: "org-dali-1", neonProjectIds: ["np-a"] });
    expect(values("flyOrgSlug")).toEqual(["dali-os"]);
    expect(values("flyAppNames")).toEqual(["ultrasound"]);
    expect(values("neonOrgId")).toEqual(["org-dali-1"]);
    expect(values("neonProjectIds")).toEqual(["np-a"]);
    expect(values("infraEnabled")).toEqual(["on"]);
  });

  it("posts empty orgs and no links for an unconfigured project", () => {
    render(blank);
    expect(values("flyOrgSlug")).toEqual([""]);
    expect(values("neonOrgId")).toEqual([""]);
    expect(values("flyAppNames")).toEqual([]);
    expect(values("neonProjectIds")).toEqual([]);
  });

  it("hides the Fly token fields until a Fly org is set", () => {
    render(blank);
    expect(container.querySelector('input[name="flyReadToken"]')).toBeNull();
  });

  it("shows token fields with a keep hint once tokens are set", () => {
    render({ ...blank, flyOrgSlug: "dali-os", hasFlyReadToken: true });
    expect(container.querySelector<HTMLInputElement>('input[name="flyReadToken"]')!.placeholder).toBe("Set. Leave blank to keep");
    expect(container.querySelector<HTMLInputElement>('input[name="flyWriteToken"]')!.placeholder).toBe("FlyV1 …");
  });

  it("never renders a token value", () => {
    render({ ...blank, flyOrgSlug: "dali-os", hasFlyReadToken: true, hasFlyWriteToken: true });
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type="password"]')) expect(input.value).toBe("");
  });
});

describe("InfraConfigFields Vaultwarden", () => {
  it("hides the group picker when Vaultwarden isn't configured", () => {
    render(blank);
    expect(values("vaultwardenGroupId")).toEqual([]);
  });

  it("posts the linked group", () => {
    render({ ...blank, vaultwardenGroupId: "g1" }, [{ id: "g1", name: "Ultrasound" }]);
    expect(values("vaultwardenGroupId")).toEqual(["g1"]);
  });

  it("defaults an unlinked project to None", () => {
    render(blank, [{ id: "g1", name: "Ultrasound" }]);
    expect(new Set(values("vaultwardenGroupId"))).toEqual(new Set([""]));
  });
});

describe("withOwnOrg", () => {
  it("adds the project's own org when nobody else uses it yet", () => {
    expect(withOwnOrg(knownOrgs.neon, "org-new", [{ id: "x", name: "x" }])).toEqual([
      ...knownOrgs.neon,
      { orgId: "org-new", resources: [{ id: "x", name: "x" }] },
    ]);
  });

  it("leaves the list alone for a known org or none", () => {
    expect(withOwnOrg(knownOrgs.neon, "org-dali-1", [])).toBe(knownOrgs.neon);
    expect(withOwnOrg(knownOrgs.neon, null, [])).toBe(knownOrgs.neon);
  });
});
