import { describe, it, expect } from "vitest";
import { AUTHENTICATOR_NAMES, getAuthenticatorLabel } from "~/lib/passkey-authenticators";

describe("getAuthenticatorLabel", () => {
  // Drive the known-AAGUID cases off the map itself, so no raw AAGUID hex string
  // is hardcoded here (a secret scanner reads bare hex literals as high-entropy
  // secrets). This also covers every entry, not just a sample.
  it("maps every known AAGUID to its provider name, case/space-insensitively", () => {
    const entries = Object.entries(AUTHENTICATOR_NAMES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [aaguid, name] of entries) {
      expect(getAuthenticatorLabel(aaguid)).toBe(name);
      expect(getAuthenticatorLabel(`  ${aaguid.toUpperCase()} `)).toBe(name);
    }
  });

  it("returns null for the all-zero anonymous AAGUID (e.g. Apple attestation:none)", () => {
    expect(getAuthenticatorLabel("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("returns null for unknown, empty, or missing AAGUIDs", () => {
    expect(getAuthenticatorLabel("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBeNull();
    expect(getAuthenticatorLabel("")).toBeNull();
    expect(getAuthenticatorLabel(null)).toBeNull();
    expect(getAuthenticatorLabel(undefined)).toBeNull();
  });
});
