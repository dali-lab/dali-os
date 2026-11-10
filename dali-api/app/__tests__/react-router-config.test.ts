import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../react-router.config";

function deployedHost(flyToml: string): string {
  const toml = readFileSync(resolve(__dirname, "../..", flyToml), "utf8");
  const collabUrl = toml.match(/COLLAB_URL\s*=\s*"([^"]+)"/)?.[1];
  if (!collabUrl) throw new Error(`${flyToml} has no COLLAB_URL`);
  return new URL(collabUrl).hostname;
}

describe("react-router.config allowedActionOrigins", () => {
  const origins = config.allowedActionOrigins ?? [];

  it.each(["fly.prod.toml", "fly.staging.toml"])(
    "allows the host %s serves on",
    (flyToml) => {
      expect(origins).toContain(deployedHost(flyToml));
    },
  );

  it("allows Fly app and PR preview hosts", () => {
    expect(origins).toContain("*.fly.dev");
  });

  it("never allows every origin", () => {
    expect(origins).not.toContain("*");
    expect(origins).not.toContain("**");
  });
});
